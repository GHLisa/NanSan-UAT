import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import dayjs from 'dayjs'

function buildCaseScope(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return {}
  if (canViewAllDepts(session.role) || !session.departmentId) return {}
  return { departmentId: session.departmentId }
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const page = parseInt(searchParams.get('page') ?? '1')
  const pageSize = parseInt(searchParams.get('pageSize') ?? '15')
  const status = searchParams.get('status') ?? '未決'   // 預設只顯示未決；'all' = 不篩選
  const keyword = searchParams.get('q')
  const deptId = searchParams.get('deptId')
  const stage = searchParams.get('stage')
  const assigneeId = searchParams.get('assigneeId')
  const incidentDateFrom = searchParams.get('incidentDateFrom')
  const incidentDateTo = searchParams.get('incidentDateTo')
  const filterYear = searchParams.get('year')       // 依結案日年份
  const filterQuarter = searchParams.get('quarter') // Q1~Q4

  const scopeFilter = buildCaseScope(session)

  const where: Record<string, unknown> = { ...scopeFilter }
  if (status && status !== 'all') where.status = status
  if (deptId) where.departmentId = parseInt(deptId)
  if (stage) where.currentStage = stage
  if (assigneeId) where.assignments = { some: { employeeId: parseInt(assigneeId) } }
  if (incidentDateFrom || incidentDateTo) {
    where.incidentDate = {
      ...(incidentDateFrom ? { gte: new Date(incidentDateFrom) } : {}),
      ...(incidentDateTo ? { lte: new Date(incidentDateTo) } : {}),
    }
  }
  // 年份/季度篩選（依結案日）
  if (filterYear) {
    const year = parseInt(filterYear)
    const qMonth: Record<string, [number, number]> = {
      Q1: [1, 3], Q2: [4, 6], Q3: [7, 9], Q4: [10, 12],
    }
    const [m1, m2] = filterQuarter ? qMonth[filterQuarter] ?? [1, 12] : [1, 12]
    where.closeDate = {
      gte: new Date(`${year}-${String(m1).padStart(2, '0')}-01`),
      lte: new Date(`${year}-${String(m2).padStart(2, '0')}-${m2 === 3 || m2 === 6 || m2 === 9 ? 30 : m2 === 12 ? 31 : 30}`),
    }
  }

  if (keyword) {
    where.OR = [
      { caseNumber: { contains: keyword, mode: 'insensitive' } },
      { insuredName: { contains: keyword, mode: 'insensitive' } },
      { policyNumber: { contains: keyword, mode: 'insensitive' } },
      { insuranceCompany: { name: { contains: keyword, mode: 'insensitive' } } },
    ]
  }

  const [total, cases] = await Promise.all([
    prisma.case.count({ where }),
    prisma.case.findMany({
      where,
      include: {
        department: { select: { name: true } },
        insuranceCompany: { select: { name: true } },
        brokerCompany: { select: { name: true } },
        assignments: { include: { employee: { select: { name: true } } }, select: { employeeId: true, role: true, travelOtherExpense: true, employee: { select: { name: true } } } },
        reviews: { where: { OR: [{ reviewStatus: '退回' }, { approvalStatus: '待執行副總閱' }, { reviewStatus: '待複核' }] }, select: { reviewStatus: true, approvalStatus: true, documentType: true, reviewRemarks: true } },
      },
      orderBy: { commissionDate: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  const today = dayjs()
  const data = cases.map((c) => {
    const daysSince = today.diff(dayjs(c.commissionDate), 'day')
    let slaStatus: 'green' | 'yellow' | 'red' = 'green'
    if (c.status === '未決') {
      if (!c.preliminaryReportDate && daysSince >= 30) slaStatus = 'red'
      else if (daysSince >= 90) slaStatus = 'red'
      else if (!c.preliminaryReportDate && daysSince >= 14) slaStatus = 'yellow'
    }
    const primaryHandler = c.assignments.find(a => a.role === '主辦') ?? c.assignments[0]
    const rejectedReviews = c.reviews.filter(r => r.reviewStatus === '退回')
    const hasPending = c.reviews.some(r => r.reviewStatus === '待複核' || r.approvalStatus === '待執行副總閱')

    return {
      id: c.id,
      caseNumber: c.caseNumber,
      departmentId: c.departmentId,
      departmentName: c.department.name,
      insuranceCompanyId: c.insuranceCompanyId,
      insuranceCompanyName: c.insuranceCompany.name,
      insuranceContact: c.insuranceContact,
      brokerCompanyName: c.brokerCompany?.name ?? null,
      policyNumber: c.policyNumber,
      insuredName: c.insuredName,
      insuranceType: c.insuranceType,
      incidentDate: c.incidentDate.toISOString(),
      commissionDate: c.commissionDate.toISOString(),
      status: c.status,
      currentStage: c.currentStage,
      parkingStatus: c.parkingStatus,
      estimatedAmount: c.estimatedAmount,
      estimatedFee: c.estimatedFee,
      actualFee: c.actualFee,
      finalAmount: c.finalAmount,
      closeDate: c.closeDate?.toISOString() ?? null,
      preliminaryReportDate: c.preliminaryReportDate?.toISOString() ?? null,
      daysSince,
      slaStatus,
      primaryHandlerName: primaryHandler?.employee.name ?? '—',
      travelOtherExpenseTotal: c.assignments.reduce((s, a) => s + (a.travelOtherExpense ?? 0), 0),
      handlers: c.assignments.map((a) => ({ id: a.employeeId, name: a.employee.name, role: a.role })),
      hasRejectedReview: rejectedReviews.length > 0,
      rejectedReviews: rejectedReviews.map(r => ({ documentType: r.documentType, reviewRemarks: r.reviewRemarks })),
      hasPendingReview: hasPending,
    }
  })

  return NextResponse.json({ success: true, data, total, page, pageSize })
}

const CaseSchema = z.object({
  departmentId: z.number(),
  insuranceCompanyId: z.number(),
  brokerCompanyId: z.number().nullable().optional(),
  insuranceContact: z.string().optional(),
  policyNumber: z.string(),
  insuredName: z.string(),
  incidentLocation: z.string(),
  incidentDate: z.string(),
  commissionDate: z.string(),
  insuranceType: z.string(),
  incidentCause: z.string(),
  estimatedAmount: z.number().nullable().optional(),
  deductible: z.number().optional(),
  isSpecialCase: z.boolean().optional(),
  notes: z.string().optional(),
  coInsurers: z.array(z.object({
    companyId: z.number().nullable().optional(),
    policyNumber: z.string(),
    ratio: z.number(),
  })).optional(),
  assignments: z.array(z.object({
    employeeId: z.number(),
    role: z.string(),
    contributionRatio: z.number(),
  })).optional(),
  dispatchId: z.number().optional(),
  contactFormStatus: z.string().optional(),
  contactReturnDate: z.string().nullable().optional(),
  nasFolder: z.string().optional(),
  parkingStatus: z.string().nullable().optional(),
  estimatedFee: z.number().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const body = CaseSchema.parse(await req.json())

  // Generate case number
  const dept = await prisma.department.findUnique({ where: { id: body.departmentId } })
  if (!dept) return NextResponse.json({ success: false, error: '部門不存在' }, { status: 400 })

  const ic = await prisma.insuranceCompany.findUnique({ where: { id: body.insuranceCompanyId } })
  if (!ic) return NextResponse.json({ success: false, error: '保險公司不存在' }, { status: 400 })

  const seq = await prisma.caseNumberSeq.upsert({
    where: { deptCode: dept.code },
    create: { deptCode: dept.code, nextSeq: 2 },
    update: { nextSeq: { increment: 1 } },
  })
  const year = String(dayjs().year()).slice(-2)
  const caseNumber = `${dept.code}-${ic.code}-${year}-${String(seq.nextSeq - 1).padStart(3, '0')}`

  const newCase = await prisma.case.create({
    data: {
      caseNumber,
      departmentId: body.departmentId,
      insuranceCompanyId: body.insuranceCompanyId,
      brokerCompanyId: body.brokerCompanyId,
      insuranceContact: body.insuranceContact,
      policyNumber: body.policyNumber,
      insuredName: body.insuredName,
      incidentLocation: body.incidentLocation,
      incidentDate: new Date(body.incidentDate),
      commissionDate: new Date(body.commissionDate),
      insuranceType: body.insuranceType,
      incidentCause: body.incidentCause,
      estimatedAmount: body.estimatedAmount,
      deductible: body.deductible ?? 0,
      isSpecialCase: body.isSpecialCase ?? false,
      notes: body.notes,
      contactFormStatus: body.contactFormStatus,
      contactReturnDate: body.contactReturnDate ? new Date(body.contactReturnDate) : undefined,
      nasFolder: body.nasFolder,
      parkingStatus: body.parkingStatus,
      estimatedFee: body.estimatedFee,
      coInsurers: body.coInsurers ? {
        create: body.coInsurers.map((ci) => ({
          companyId: ci.companyId,
          policyNumber: ci.policyNumber,
          ratio: ci.ratio,
        })),
      } : undefined,
      assignments: body.assignments ? {
        create: body.assignments.map((a) => ({
          employeeId: a.employeeId,
          role: a.role,
          contributionRatio: a.contributionRatio,
        })),
      } : undefined,
    },
  })

  // 若從派案池建案，更新 dispatch 狀態
  if (body.dispatchId) {
    await prisma.dispatchQueue.update({
      where: { id: body.dispatchId },
      data: { status: '已成案', pickedBy: parseInt(session.sub) },
    })
  }

  // 建立進件進度記錄
  await prisma.caseProgress.create({
    data: {
      caseId: newCase.id,
      stage: '進件/建檔',
      progressDate: new Date(),
      description: `案件建立 (${session.name})`,
      createdBy: parseInt(session.sub),
    },
  })

  await prisma.caseLog.create({
    data: {
      caseId: newCase.id,
      employeeId: parseInt(session.sub),
      fieldName: '建案',
      logType: 'create',
      newValue: caseNumber,
    },
  })

  return NextResponse.json({ success: true, data: { id: newCase.id, caseNumber } }, { status: 201 })
}
