import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// 結算單筆查詢（GET）與更新（PATCH）— 補齊 GenWebSite Tasks T19 規劃之 get/update 端點
// 回傳格式對齊 /api/settlements（list）的單筆結構

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const id = parseInt(params.id)
  const s = await prisma.settlement.findUnique({
    where: { id },
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
  })
  if (!s) return NextResponse.json({ success: false, error: '找不到結算記錄' }, { status: 404 })

  return NextResponse.json({
    success: true,
    data: {
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
    },
  })
}

const SplitSchema = z.object({
  employeeId: z.number(),
  assignmentId: z.number().nullable().optional(),
  ratio: z.number(),
  amount: z.number(),
})

const UpdateSchema = z.object({
  reportDate: z.string().optional(),
  baseFee: z.number().optional(),
  travelExpense: z.number().optional(),
  totalFee: z.number().optional(),
  remarks: z.string().nullable().optional(),
  splits: z.array(SplitSchema).optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const id = parseInt(params.id)
  const existing = await prisma.settlement.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ success: false, error: '找不到結算記錄' }, { status: 404 })

  let body: z.infer<typeof UpdateSchema>
  try {
    body = UpdateSchema.parse(await req.json())
  } catch {
    return NextResponse.json({ success: false, error: '更新資料格式錯誤' }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.settlement.update({
      where: { id },
      data: {
        ...(body.reportDate !== undefined ? { reportDate: new Date(body.reportDate) } : {}),
        ...(body.baseFee !== undefined ? { baseFee: body.baseFee } : {}),
        ...(body.travelExpense !== undefined ? { travelExpense: body.travelExpense } : {}),
        ...(body.totalFee !== undefined ? { totalFee: body.totalFee } : {}),
        ...(body.remarks !== undefined ? { remarks: body.remarks } : {}),
      },
    })

    // splits 若帶入則整批覆寫
    if (body.splits) {
      await tx.settlementSplit.deleteMany({ where: { settlementId: id } })
      await tx.settlementSplit.createMany({
        data: body.splits.map((sp) => ({
          settlementId: id,
          employeeId: sp.employeeId,
          assignmentId: sp.assignmentId ?? null,
          ratio: sp.ratio,
          amount: sp.amount,
        })),
      })
    }

    // 同步更新案件實際公證費（與 POST /api/settlements 一致）
    if (body.totalFee !== undefined) {
      await tx.case.update({ where: { id: existing.caseId }, data: { actualFee: body.totalFee } })
    }
  })

  return NextResponse.json({ success: true, data: { id } })
}
