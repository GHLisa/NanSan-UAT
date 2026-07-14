import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { DEFAULT_SETTINGS } from '@/lib/settings'

// 系統參數設定 — 僅系統管理員可查詢與維護

// GET：回傳所有參數；同時補齊缺漏的預設參數（create-only，不覆蓋既有值）
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  // 補齊預設參數（缺漏才建立，既有值保持不動）
  for (const d of DEFAULT_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: d.key },
      create: { key: d.key, value: d.value, label: d.label, description: d.description },
      update: {},
    })
  }

  const rows = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } })
  return NextResponse.json({
    success: true,
    data: rows.map(r => ({
      key: r.key,
      value: r.value,
      label: r.label,
      description: r.description,
      updatedAt: r.updatedAt.toISOString(),
    })),
  })
}

// PUT：更新單一參數值（依 key）
export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const body = await req.json().catch(() => null) as { key?: string; value?: string } | null
  const key = body?.key?.trim()
  const value = body?.value?.trim()
  if (!key || value == null || value === '') {
    return NextResponse.json({ success: false, error: '參數代碼與參數值必填' }, { status: 400 })
  }

  const def = DEFAULT_SETTINGS.find(d => d.key === key)
  const updated = await prisma.systemSetting.upsert({
    where: { key },
    create: {
      key,
      value,
      label: def?.label ?? key,
      description: def?.description,
      updatedById: parseInt(session.sub),
    },
    update: { value, updatedById: parseInt(session.sub) },
  })

  return NextResponse.json({ success: true, data: { key: updated.key, value: updated.value } })
}
