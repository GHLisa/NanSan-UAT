import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type MasterDataType =
  | 'insurance-companies'
  | 'broker-companies'
  | 'insurance-types'
  | 'incident-locations'
  | 'departments'
  | 'regions'

function getModelAndFields(type: MasterDataType) {
  switch (type) {
    case 'insurance-companies':
      return { model: 'insuranceCompany' as const, fields: ['id', 'code', 'name'] }
    case 'broker-companies':
      return { model: 'brokerCompany' as const, fields: ['id', 'name', 'isActive'] }
    case 'insurance-types':
      return { model: 'insuranceType' as const, fields: ['id', 'name', 'feeCategory', 'isActive'] }
    case 'incident-locations':
      return { model: 'incidentLocation' as const, fields: ['id', 'name', 'isActive'] }
    case 'departments':
      return { model: 'department' as const, fields: ['id', 'code', 'name', 'regionId'] }
    case 'regions':
      return { model: 'region' as const, fields: ['id', 'code', 'name'] }
    default:
      return null
  }
}

export async function GET(_req: NextRequest, { params }: { params: { type: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const type = params.type as MasterDataType
  const info = getModelAndFields(type)
  if (!info) return NextResponse.json({ success: false, error: '無效的資料類型' }, { status: 400 })

  // departments: include region name
  if (type === 'departments') {
    const depts = await prisma.department.findMany({
      include: { region: { select: { name: true } } },
      orderBy: { id: 'asc' },
    })
    return NextResponse.json({
      success: true,
      data: depts.map(d => ({ id: d.id, code: d.code, name: d.name, regionId: d.regionId, regionName: d.region.name })),
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await (prisma[info.model] as any).findMany({ orderBy: { id: 'asc' } })

  return NextResponse.json({ success: true, data })
}

export async function POST(req: NextRequest, { params }: { params: { type: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const type = params.type as MasterDataType
  const info = getModelAndFields(type)
  if (!info) return NextResponse.json({ success: false, error: '無效的資料類型' }, { status: 400 })

  const body = await req.json()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const created = await (prisma[info.model] as any).create({ data: body })

  return NextResponse.json({ success: true, data: { id: created.id } }, { status: 201 })
}

export async function PATCH(req: NextRequest, { params }: { params: { type: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const id = parseInt(searchParams.get('id') ?? '0')
  if (!id) return NextResponse.json({ success: false, error: 'id 必填' }, { status: 400 })

  const type = params.type as MasterDataType
  const info = getModelAndFields(type)
  if (!info) return NextResponse.json({ success: false, error: '無效的資料類型' }, { status: 400 })

  const body = await req.json() as { isActive?: boolean; name?: string }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updated = await (prisma[info.model] as any).update({ where: { id }, data: body })

  return NextResponse.json({ success: true, data: { id: updated.id } })
}
