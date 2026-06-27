import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'
import { calcCertificationFee } from '@/lib/feeCalc'

const FeeCalcSchema = z.object({
  amount: z.number(),
  insuranceCompanyId: z.number(),
  insuranceTypeId: z.number(),
  commissionDate: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const parsed = FeeCalcSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '參數錯誤' }, { status: 400 })
  }

  const { amount, insuranceCompanyId, insuranceTypeId, commissionDate } = parsed.data

  const result = await calcCertificationFee(amount, {
    insuranceCompanyId,
    insuranceTypeId,
    commissionDate,
  })

  return NextResponse.json({ success: true, data: result })
}
