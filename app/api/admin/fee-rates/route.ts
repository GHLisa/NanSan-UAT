import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

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
  subRate: z.string().optional(),
  mealExpense: z.number().optional(),
  accommodationExpense: z.number().optional(),
  photoFee: z.number().optional(),
  // Fire fields
  remarks: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const body = FeeRateSchema.parse(await req.json())

  if (body.type === '火險') {
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

  const rate = await prisma.companyFeeRate.create({
    data: {
      companyCode: body.companyCode,
      companyName: body.companyName,
      insuranceType: body.insuranceType ?? '',
      debitNoteType: body.debitNoteType,
      minFee: body.minFee,
      rateBands: body.rateBands,
      subRate: body.subRate,
      mealExpense: body.mealExpense ?? 0,
      accommodationExpense: body.accommodationExpense ?? 0,
      photoFee: body.photoFee ?? 0,
      effectiveDate: new Date(body.effectiveDate),
    },
  })
  return NextResponse.json({ success: true, data: { id: rate.id } }, { status: 201 })
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const id = parseInt(searchParams.get('id') ?? '0')
  const type = searchParams.get('type')
  if (!id) return NextResponse.json({ success: false, error: 'id 必填' }, { status: 400 })

  const body = await req.json()

  if (type === '火險') {
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
    await prisma.companyFeeRate.update({
      where: { id },
      data: {
        companyCode: body.companyCode, companyName: body.companyName,
        insuranceType: body.insuranceType ?? '',
        debitNoteType: body.debitNoteType, minFee: body.minFee,
        rateBands: body.rateBands, subRate: body.subRate,
        mealExpense: body.mealExpense ?? 0,
        accommodationExpense: body.accommodationExpense ?? 0,
        photoFee: body.photoFee ?? 0,
        effectiveDate: new Date(body.effectiveDate),
      },
    })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

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
