import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { parseBody } from '@/lib/apiError'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const year = searchParams.get('year')
  const deptId = searchParams.get('deptId')

  const caseWhere: Record<string, unknown> = { status: '已決' }

  if (!canViewAllDepts(session.role) && session.departmentId) {
    caseWhere.departmentId = session.departmentId
  } else if (deptId) {
    caseWhere.departmentId = parseInt(deptId)
  }

  if (year) {
    const y = parseInt(year)
    caseWhere.closeDate = {
      gte: new Date(`${y}-01-01`),
      lt: new Date(`${y + 1}-01-01`),
    }
  }

  const settlements = await prisma.settlement.findMany({
    where: { case: caseWhere },
    include: {
      case: {
        select: {
          caseNumber: true,
          insuredName: true,
          insuranceType: true,
          insuranceCompany: { select: { name: true } },
          department: { select: { name: true } },
          assignments: { include: { employee: { select: { name: true } } } },
        },
      },
      splits: { include: { employee: { select: { name: true } } } },
    },
    orderBy: { reportDate: 'desc' },
    take: 200,
  })

  return NextResponse.json({
    success: true,
    data: settlements.map((s) => ({
      id: s.id,
      caseId: s.caseId,
      caseNumber: s.case.caseNumber,
      insuredName: s.case.insuredName,
      insuranceType: s.case.insuranceType,
      insuranceCompanyName: s.case.insuranceCompany.name,
      departmentName: s.case.department.name,
      reportDate: s.reportDate.toISOString(),
      baseFee: s.baseFee,
      travelExpense: s.travelExpense,
      totalFee: s.totalFee,
      remarks: s.remarks,
      handlers: s.case.assignments.map((a) => ({ name: a.employee.name, role: a.role })),
      splits: s.splits.map((sp) => ({
        id: sp.id,
        employeeId: sp.employeeId,
        employeeName: sp.employee.name,
        ratio: sp.ratio,
        amount: sp.amount,
      })),
    })),
  })
}

const SplitSchema = z.object({
  employeeId: z.number(),
  assignmentId: z.number().nullable().optional(),
  ratio: z.number(),
  amount: z.number(),
})

const SettlementSchema = z.object({
  caseId: z.number(),
  reportDate: z.string(),
  baseFee: z.number(),
  travelExpense: z.number().default(0),
  totalFee: z.number(),
  remarks: z.string().optional(),
  splits: z.array(SplitSchema).optional(),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  // [2026/07/01] - Lisa - 改用 parseBody：驗證失敗回 400 JSON，不再 throw 成 500 非 JSON
  const parsed = await parseBody(req, SettlementSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const existing = await prisma.settlement.findUnique({ where: { caseId: body.caseId } })
  if (existing) {
    return NextResponse.json({ success: false, error: '此案件已有結算記錄' }, { status: 400 })
  }

  const settlement = await prisma.settlement.create({
    data: {
      caseId: body.caseId,
      reportDate: new Date(body.reportDate),
      baseFee: body.baseFee,
      travelExpense: body.travelExpense,
      totalFee: body.totalFee,
      remarks: body.remarks,
      splits: body.splits ? {
        create: body.splits.map((sp) => ({
          employeeId: sp.employeeId,
          assignmentId: sp.assignmentId,
          ratio: sp.ratio,
          amount: sp.amount,
        })),
      } : undefined,
    },
  })

  await prisma.case.update({
    where: { id: body.caseId },
    data: { status: '已決', closeDate: new Date(), actualFee: body.totalFee },
  })

  await prisma.caseLog.create({
    data: {
      caseId: body.caseId,
      employeeId: parseInt(session.sub),
      fieldName: '已決結算',
      logType: 'create',
      newValue: `公證費 ${body.totalFee}`,
    },
  })

  return NextResponse.json({ success: true, data: { id: settlement.id } }, { status: 201 })
}
