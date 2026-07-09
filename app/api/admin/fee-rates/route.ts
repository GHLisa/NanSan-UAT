import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { parseBody } from '@/lib/apiError'
import { canManageFeeRates } from '@/lib/permissions'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const type = searchParams.get('type')

  if (type === '火險') {
    const rates = await prisma.companyFireRate.findMany({
      orderBy: [{ companyCode: 'asc' }, { effectiveDate: 'desc' }],
    })
    return NextResponse.json({
      success: true,
      data: rates.map((r) => ({
        id: r.id,
        companyCode: r.companyCode,
        companyName: r.companyName,
        debitNoteType: r.debitNoteType,
        minFee: r.minFee,
        rateBands: r.rateBands,
        remarks: r.remarks,
        effectiveDate: r.effectiveDate.toISOString(),
      })),
    })
  }

  // Default: engineering/liability fee rates
  const rates = await prisma.companyFeeRate.findMany({
    orderBy: [{ companyCode: 'asc' }, { effectiveDate: 'desc' }],
  })
  return NextResponse.json({
    success: true,
    data: rates.map((r) => ({
      id: r.id,
      companyCode: r.companyCode,
      companyName: r.companyName,
      insuranceType: r.insuranceType,
      debitNoteType: r.debitNoteType,
      minFee: r.minFee,
      rateBands: r.rateBands,
      subRate: r.subRate,
      mealExpense: r.mealExpense,
      accommodationExpense: r.accommodationExpense,
      photoFee: r.photoFee,
      effectiveDate: r.effectiveDate.toISOString(),
    })),
  })
}

const FeeRateSchema = z.object({
  type: z.enum(['工程', '火險']),
  companyCode: z.string(),
  companyName: z.string(),
  debitNoteType: z.string(),
  minFee: z.number().default(20000),
  rateBands: z.string(),
  effectiveDate: z.string(),
  // Engineering fields
  insuranceType: z.string().optional(),
  subRate: z.string().nullable().optional(),
  // 費用補貼為 JSON 編碼字串（"0"=不給、"400"=固定、{"morning":..}=分時、{"taipei":..}=分地點、"null"=改不給）
  mealExpense: z.string().optional(),
  accommodationExpense: z.string().optional(),
  photoFee: z.string().optional(),
  // Fire fields
  remarks: z.string().optional(),
})

// 險種組合正規化：拆分、去空白、排序後 join，用於組合比對
function normalizeTypes(insuranceType?: string): string {
  return (insuranceType ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .sort()
    .join(',')
}

// FR-78 工程責任險唯一性：公司代號 ＋ 險種組合（排序後） ＋ 生效日 不可重複
async function isEngDuplicate(companyCode: string, insuranceType: string | undefined, effectiveDate: Date, excludeId?: number): Promise<boolean> {
  const target = normalizeTypes(insuranceType)
  const rows = await prisma.companyFeeRate.findMany({
    where: { companyCode, effectiveDate, ...(excludeId ? { id: { not: excludeId } } : {}) },
  })
  return rows.some((r) => normalizeTypes(r.insuranceType) === target)
}

// FR-17 火險唯一性：公司代號 ＋ 生效日 不可重複
async function isFireDuplicate(companyCode: string, effectiveDate: Date, excludeId?: number): Promise<boolean> {
  const count = await prisma.companyFireRate.count({
    where: { companyCode, effectiveDate, ...(excludeId ? { id: { not: excludeId } } : {}) },
  })
  return count > 0
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (!canManageFeeRates(session.role)) return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  // [2026/07/01] - Lisa - 改用 parseBody：驗證失敗回 400 JSON，不再 throw 成 500 非 JSON
  const parsed = await parseBody(req, FeeRateSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const effectiveDate = new Date(body.effectiveDate)

  if (body.type === '火險') {
    if (await isFireDuplicate(body.companyCode, effectiveDate)) {
      return NextResponse.json({ success: false, error: '公司代號＋生效日 組合已存在' }, { status: 409 })
    }
    const rate = await prisma.companyFireRate.create({
      data: {
        companyCode: body.companyCode,
        companyName: body.companyName,
        debitNoteType: body.debitNoteType,
        minFee: body.minFee,
        rateBands: body.rateBands,
        remarks: body.remarks,
        effectiveDate: new Date(body.effectiveDate),
      },
    })
    return NextResponse.json({ success: true, data: { id: rate.id } }, { status: 201 })
  }

  if (await isEngDuplicate(body.companyCode, body.insuranceType, effectiveDate)) {
    return NextResponse.json({ success: false, error: '公司代號＋險種組合＋生效日 已存在' }, { status: 409 })
  }

  const rate = await prisma.companyFeeRate.create({
    data: {
      companyCode: body.companyCode,
      companyName: body.companyName,
      insuranceType: body.insuranceType ?? '',
      debitNoteType: body.debitNoteType,
      minFee: body.minFee,
      rateBands: body.rateBands,
      subRate: body.subRate ?? null,
      mealExpense: body.mealExpense ?? '0',
      accommodationExpense: body.accommodationExpense ?? '0',
      photoFee: body.photoFee ?? '0',
      effectiveDate: new Date(body.effectiveDate),
    },
  })
  return NextResponse.json({ success: true, data: { id: rate.id } }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (!canManageFeeRates(session.role)) return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const id = parseInt(searchParams.get('id') ?? '0')
  const type = searchParams.get('type')
  if (!id) return NextResponse.json({ success: false, error: 'id 必填' }, { status: 400 })

  const body = await req.json()
  const effectiveDate = new Date(body.effectiveDate)

  if (type === '火險') {
    if (await isFireDuplicate(body.companyCode, effectiveDate, id)) {
      return NextResponse.json({ success: false, error: '公司代號＋生效日 組合已存在' }, { status: 409 })
    }
    await prisma.companyFireRate.update({
      where: { id },
      data: {
        companyCode: body.companyCode, companyName: body.companyName,
        debitNoteType: body.debitNoteType, minFee: body.minFee,
        rateBands: body.rateBands, remarks: body.remarks,
        effectiveDate: new Date(body.effectiveDate),
      },
    })
  } else {
    if (await isEngDuplicate(body.companyCode, body.insuranceType, effectiveDate, id)) {
      return NextResponse.json({ success: false, error: '公司代號＋險種組合＋生效日 已存在' }, { status: 409 })
    }
    await prisma.companyFeeRate.update({
      where: { id },
      data: {
        companyCode: body.companyCode, companyName: body.companyName,
        insuranceType: body.insuranceType ?? '',
        debitNoteType: body.debitNoteType, minFee: body.minFee,
        rateBands: body.rateBands, subRate: body.subRate ?? null,
        mealExpense: body.mealExpense ?? '0',
        accommodationExpense: body.accommodationExpense ?? '0',
        photoFee: body.photoFee ?? '0',
        effectiveDate: new Date(body.effectiveDate),
      },
    })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (!canManageFeeRates(session.role)) return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const id = parseInt(searchParams.get('id') ?? '0')
  const type = searchParams.get('type')

  if (!id) return NextResponse.json({ success: false, error: 'id 必填' }, { status: 400 })

  if (type === '火險') {
    await prisma.companyFireRate.delete({ where: { id } })
  } else {
    await prisma.companyFeeRate.delete({ where: { id } })
  }

  return NextResponse.json({ success: true })
}
