import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { z } from 'zod'

const FeeCalcSchema = z.object({
  estimatedAmount: z.number(),
  insuranceType: z.string(),
  companyCode: z.string().optional(),
  commissionDate: z.string().optional(),
})

function calcBaseFee(amount: number): number {
  const MIN_FEE = 20000
  if (amount <= 0) return MIN_FEE

  let fee = 0
  // Tiered rate bands (simplified standard rate)
  const bands = [
    { limit: 5_000_000, rate: 0.004 },
    { limit: 10_000_000, rate: 0.003 },
    { limit: 30_000_000, rate: 0.002 },
    { limit: 50_000_000, rate: 0.0015 },
    { limit: 100_000_000, rate: 0.001 },
    { limit: Infinity, rate: 0.0008 },
  ]

  let remaining = amount
  let prev = 0
  for (const band of bands) {
    if (remaining <= 0) break
    const bandAmount = band.limit === Infinity ? remaining : Math.min(remaining, band.limit - prev)
    fee += bandAmount * band.rate
    remaining -= bandAmount
    prev = band.limit
  }

  return Math.max(Math.round(fee / 100) * 100, MIN_FEE)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const body = FeeCalcSchema.parse(await req.json())

  const baseFee = calcBaseFee(body.estimatedAmount)
  const minFee = 20000

  return NextResponse.json({
    success: true,
    data: {
      estimatedAmount: body.estimatedAmount,
      baseFee,
      minFee,
      note: body.estimatedAmount <= 0
        ? '金額未填，套用最低費率'
        : `依估計損失 ${body.estimatedAmount.toLocaleString()} 試算`,
    },
  })
}
