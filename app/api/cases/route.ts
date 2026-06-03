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
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20')
  const status = searchParams.get('status')
  const keyword = searchParams.get('q')
  const deptId = searchParams.get('deptId')
  const insuranceCompanyId = searchParams.get('icId')
  const insuranceType = searchParams.get('type')

  const scopeFilter = buildCaseScope(session)

  const where: Record<string, unknown> = { ...scopeFilter }
  if (status) where.status = status
  if (deptId) where.departmentId = parseInt(deptId)
  if (insuranceCompanyId) where.insuranceCompanyId = parseInt(insuranceCompanyId)
  if (insuranceType) where.insuranceType = insuranceType
  if (keyword) {
    where.OR = [
      { caseNumber: { contains: keyword, mode: 'insensitive' } },
      { insuredName: { contains: keyword, mode: 'insensitive' } },
      { policyNumber: { contains: keyword, mode: 'insensitive' } },
    ]
  }

  const [total, cases] = await Promise.all([
    prisma.case.count({ where }),
    prisma.case.findMany({
      where,
      include: {
        department: { select: { name: true } },
        insuranceCompany: { select: { name: true } },
        assignments: { include: { employee: { select: { name: true } } } },
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
      else if (!c.preliminaryReportDate && daysSince >= 14) slaStatus = 'yellow'
    }
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      departmentId: c.departmentId,
      departmentName: c.department.name,
      insuranceCompanyId: c.insuranceCompanyId,
      insuranceCompanyName: c.insuranceCompany.name,
      insuredName: c.insuredName,
      insuranceType: c.insuranceType,
      incidentDate: c.incidentDate.toISOString(),
      commissionDate: c.commissionDate.toISOString(),
      status: c.status,
      currentStage: c.currentStage,
      estimatedAmount: c.estimatedAmount,
      estimatedFee: c.estimatedFee,
      actualFee: c.actualFee,
      slaStatus,
      handlers: c.assignments.map((a) => ({ id: a.employeeId, name: a.employee.name, role: a.role })),
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

  // Log creation
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
