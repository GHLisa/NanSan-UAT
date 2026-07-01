import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type MasterDataType =
  | 'insurance-companies'
  | 'broker-companies'
  | 'insurance-types'
  | 'incident-locations'
  | 'incident-causes'
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
    case 'incident-causes':
      return { model: 'incidentCause' as const, fields: ['id', 'name', 'isActive'] }
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
      data: depts.map(d => ({ id: d.id, code: d.code, caseNoCode: d.caseNoCode, name: d.name, regionId: d.regionId, regionName: d.region.name })),
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await (prisma[info.model] as any).findMany({ orderBy: { id: 'asc' } })

  return NextResponse.json({ success: true, data })
}

export async function POST(req: NextRequest, { params }: { params: { type: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  // [2026/07/01] - Lisa - 基礎資料開放行政人員：sysadmin 或 admin_staff 皆可寫入
  if (session.role !== 'sysadmin' && session.role !== 'admin_staff') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

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
  // [2026/07/01] - Lisa - 基礎資料開放行政人員：sysadmin 或 admin_staff 皆可寫入
  if (session.role !== 'sysadmin' && session.role !== 'admin_staff') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const id = parseInt(searchParams.get('id') ?? '0')
  if (!id) return NextResponse.json({ success: false, error: 'id 必填' }, { status: 400 })

  const type = params.type as MasterDataType
  const info = getModelAndFields(type)
  if (!info) return NextResponse.json({ success: false, error: '無效的資料類型' }, { status: 400 })

  const body = await req.json() as { isActive?: boolean; name?: string; feeCategory?: string; confirmRename?: boolean; caseNoCode?: string | null }

  // [2026/07/01] - Lisa - 開放編輯險種名稱：案件以「名稱字串」快照儲存險種，改名須同步更新既有案件
  if (type === 'insurance-types') {
    const current = await prisma.insuranceType.findUnique({ where: { id } })
    if (!current) return NextResponse.json({ success: false, error: '找不到險種' }, { status: 404 })

    const newName = body.name?.trim()
    const isRename = !!newName && newName !== current.name

    if (isRename) {
      // 名稱重複檢查（排除自身）
      const dupe = await prisma.insuranceType.findFirst({ where: { name: newName, id: { not: id } } })
      if (dupe) return NextResponse.json({ success: false, error: '險種名稱已存在' }, { status: 409 })

      // 既有案件使用數 > 0 且未確認 → 回 409 提示，前端確認後帶 confirmRename 重送
      const affected = await prisma.case.count({ where: { insuranceType: current.name } })
      if (affected > 0 && body.confirmRename !== true) {
        return NextResponse.json({
          success: false,
          code: 'RENAME_AFFECTS_CASES',
          error: `目前有 ${affected} 件案件使用險種「${current.name}」，儲存後將一併同步更新為「${newName}」，確定要更新嗎？`,
        }, { status: 409 })
      }

      // 同一交易：更新險種 + 同步既有案件的險種名稱字串
      await prisma.$transaction([
        prisma.insuranceType.update({
          where: { id },
          data: { name: newName, feeCategory: body.feeCategory, isActive: body.isActive },
        }),
        prisma.case.updateMany({
          where: { insuranceType: current.name },
          data: { insuranceType: newName },
        }),
      ])
      return NextResponse.json({ success: true, data: { id } })
    }

    // 未改名：僅更新費率類別 / 啟用狀態
    const updated = await prisma.insuranceType.update({
      where: { id },
      data: { feeCategory: body.feeCategory, isActive: body.isActive },
    })
    return NextResponse.json({ success: true, data: { id: updated.id } })
  }

  // [2026/07/01] - Lisa - 出險原因：案件以「名稱字串」快照儲存 incidentCause，改名須同步更新既有案件
  if (type === 'incident-causes') {
    const current = await prisma.incidentCause.findUnique({ where: { id } })
    if (!current) return NextResponse.json({ success: false, error: '找不到出險原因' }, { status: 404 })

    const newName = body.name?.trim()
    const isRename = !!newName && newName !== current.name

    if (isRename) {
      // 名稱重複檢查（排除自身）
      const dupe = await prisma.incidentCause.findFirst({ where: { name: newName, id: { not: id } } })
      if (dupe) return NextResponse.json({ success: false, error: '出險原因已存在' }, { status: 409 })

      // 既有案件使用數 > 0 且未確認 → 回 409 提示，前端確認後帶 confirmRename 重送
      const affected = await prisma.case.count({ where: { incidentCause: current.name } })
      if (affected > 0 && body.confirmRename !== true) {
        return NextResponse.json({
          success: false,
          code: 'RENAME_AFFECTS_CASES',
          error: `目前有 ${affected} 件案件使用出險原因「${current.name}」，儲存後將一併同步更新為「${newName}」，確定要更新嗎？`,
        }, { status: 409 })
      }

      // 同一交易：更新出險原因 + 同步既有案件的出險原因名稱字串
      await prisma.$transaction([
        prisma.incidentCause.update({ where: { id }, data: { name: newName, isActive: body.isActive } }),
        prisma.case.updateMany({ where: { incidentCause: current.name }, data: { incidentCause: newName } }),
      ])
      return NextResponse.json({ success: true, data: { id } })
    }

    // 未改名：僅更新啟用狀態
    const updated = await prisma.incidentCause.update({ where: { id }, data: { isActive: body.isActive } })
    return NextResponse.json({ success: true, data: { id: updated.id } })
  }

  // [2026/07/01] - Lisa - 部門僅開放編輯「公證編號代號」(caseNoCode)；代碼/名稱/區域涉及審核分類與權限，不於此編輯
  if (type === 'departments') {
    const updated = await prisma.department.update({
      where: { id },
      data: { caseNoCode: body.caseNoCode ?? null },
    })
    return NextResponse.json({ success: true, data: { id: updated.id } })
  }

  // [2026/07/01] - Lisa - 區域僅開放編輯「公證編號代號」(caseNoCode)；允許空字串（台北無區域段）
  if (type === 'regions') {
    const updated = await prisma.region.update({
      where: { id },
      data: { caseNoCode: (body.caseNoCode ?? '').trim() },
    })
    return NextResponse.json({ success: true, data: { id: updated.id } })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updated = await (prisma[info.model] as any).update({ where: { id }, data: body })

  return NextResponse.json({ success: true, data: { id: updated.id } })
}

// [2026/07/01] - Lisa - 出險原因支援刪除（其他基礎資料維持停用機制，不提供刪除）
export async function DELETE(req: NextRequest, { params }: { params: { type: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin' && session.role !== 'admin_staff') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const id = parseInt(searchParams.get('id') ?? '0')
  if (!id) return NextResponse.json({ success: false, error: 'id 必填' }, { status: 400 })

  const type = params.type as MasterDataType
  if (type !== 'incident-causes') {
    return NextResponse.json({ success: false, error: '此類型不支援刪除' }, { status: 400 })
  }

  // 案件以名稱字串快照儲存出險原因，刪除設定不影響既有案件已填寫的值
  await prisma.incidentCause.delete({ where: { id } })
  return NextResponse.json({ success: true, data: { id } })
}
