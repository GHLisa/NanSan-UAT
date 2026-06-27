import { NextRequest, NextResponse } from 'next/server'
import { getSession, JWTPayload } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import dayjs from 'dayjs'

// ── 可設定對象（對齊 demo FeeTargetPage subordinates）─────────────────────
// team_lead：同部門同組別的承辦人；dept_manager：本部門承辦人＋組長；其餘角色無對象
async function getSubordinates(session: JWTPayload) {
  let roleWhere: Record<string, unknown> | null = null
  if (session.role === 'team_lead' && session.departmentId) {
    roleWhere = { departmentId: session.departmentId, teamGroup: session.teamGroup, role: 'handler' }
  } else if (session.role === 'dept_manager' && session.departmentId) {
    roleWhere = { departmentId: session.departmentId, role: { in: ['handler', 'team_lead'] } }
  }
  if (!roleWhere) return []

  const roles = await prisma.employeeRole.findMany({ where: roleWhere, select: { employeeId: true } })
  const ids = [...new Set(roles.map((r) => r.employeeId))]
  if (ids.length === 0) return []

  return prisma.employee.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  })
}

// ── 年度實績：closeDate 為該年度的案件，依貢獻比例分攤 actualFee ───────────
// 對齊 demo calcActualFee / calcActualCaseCount
async function calcActuals(empIds: number[], years: number[]) {
  const map = new Map<string, { fee: number; count: number }>()
  if (empIds.length === 0 || years.length === 0) return map

  const minYear = Math.min(...years)
  const maxYear = Math.max(...years)
  const closedCases = await prisma.case.findMany({
    where: { closeDate: { gte: new Date(`${minYear}-01-01`), lt: new Date(`${maxYear + 1}-01-01`) } },
    select: {
      closeDate: true,
      actualFee: true,
      assignments: { select: { employeeId: true, contributionRatio: true } },
    },
  })

  const yearSet = new Set(years)
  const empSet = new Set(empIds)
  for (const c of closedCases) {
    const year = dayjs(c.closeDate).year()
    if (!yearSet.has(year)) continue
    for (const a of c.assignments) {
      if (!empSet.has(a.employeeId)) continue
      const key = `${a.employeeId}-${year}`
      const entry = map.get(key) ?? { fee: 0, count: 0 }
      entry.count += 1
      if (c.actualFee) entry.fee += Math.round(c.actualFee * (a.contributionRatio ?? 1))
      map.set(key, entry)
    }
  }
  return map
}

// ── 庫存：未決案件的預估公證費（依貢獻比例分攤）與件數 ─────────────────────
// 對齊 demo calcInventoryFee / calcInventoryCaseCount
async function calcInventory(empIds: number[]) {
  const map = new Map<number, { fee: number; count: number }>()
  if (empIds.length === 0) return map

  const openCases = await prisma.case.findMany({
    where: { status: '未決' },
    select: {
      estimatedFee: true,
      assignments: { select: { employeeId: true, contributionRatio: true } },
    },
  })

  const empSet = new Set(empIds)
  for (const c of openCases) {
    for (const a of c.assignments) {
      if (!empSet.has(a.employeeId)) continue
      const entry = map.get(a.employeeId) ?? { fee: 0, count: 0 }
      entry.count += 1
      entry.fee += Math.round((c.estimatedFee ?? 0) * (a.contributionRatio ?? 1))
      map.set(a.employeeId, entry)
    }
  }
  return map
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const subordinates = await getSubordinates(session)
  const subIds = subordinates.map((s) => s.id)

  // ── 歷史年度目標查詢 ───────────────────────────────────────────────────
  if (req.nextUrl.searchParams.get('mode') === 'history') {
    const targets = await prisma.feeTarget.findMany({
      where: { employeeId: { in: subIds } },
      include: {
        employee: { select: { name: true } },
        setter: { select: { name: true } },
      },
      orderBy: [{ year: 'desc' }, { employeeId: 'asc' }],
    })
    const actuals = await calcActuals(subIds, [...new Set(targets.map((t) => t.year))])

    return NextResponse.json({
      success: true,
      data: targets.map((t) => {
        const actual = actuals.get(`${t.employeeId}-${t.year}`)
        return {
          id: t.id,
          employeeId: t.employeeId,
          employeeName: t.employee.name,
          year: t.year,
          targetAmount: t.targetAmount,
          targetCaseCount: t.targetCaseCount,
          actualFee: actual?.fee ?? 0,
          actualCaseCount: actual?.count ?? 0,
          setByName: t.setter.name,
          setAt: t.setAt.toISOString(),
        }
      }),
    })
  }

  // ── 年度目標設定（含前一年參考值／實績與庫存）──────────────────────────
  const year = parseInt(req.nextUrl.searchParams.get('year') ?? String(dayjs().year()))
  const refYear = year - 1

  const [targets, refActuals, inventory] = await Promise.all([
    prisma.feeTarget.findMany({
      where: { employeeId: { in: subIds }, year: { in: [year, refYear] } },
      select: { employeeId: true, year: true, targetAmount: true, targetCaseCount: true },
    }),
    calcActuals(subIds, [refYear]),
    calcInventory(subIds),
  ])

  const targetMap = new Map(targets.map((t) => [`${t.employeeId}-${t.year}`, t]))

  return NextResponse.json({
    success: true,
    data: {
      employees: subordinates,
      rows: subordinates.map((e) => {
        const cur = targetMap.get(`${e.id}-${year}`)
        const ref = targetMap.get(`${e.id}-${refYear}`)
        const refActual = refActuals.get(`${e.id}-${refYear}`)
        const inv = inventory.get(e.id)
        return {
          employeeId: e.id,
          name: e.name,
          curTargetAmount: cur?.targetAmount ?? null,
          curTargetCaseCount: cur?.targetCaseCount ?? null,
          refTargetAmount: ref?.targetAmount ?? null,
          refTargetCaseCount: ref?.targetCaseCount ?? null,
          refActualFee: refActual?.fee ?? 0,
          refActualCaseCount: refActual?.count ?? 0,
          inventoryFee: inv?.fee ?? 0,
          inventoryCaseCount: inv?.count ?? 0,
        }
      }),
    },
  })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  // 角色驗證：僅組長／部門主管可設定業績目標（對齊 demo 選單權限）
  if (session.role !== 'team_lead' && session.role !== 'dept_manager') {
    return NextResponse.json({ success: false, error: '無權限設定業績目標' }, { status: 403 })
  }

  const body = (await req.json()) as {
    year?: number
    items?: { employeeId: number; targetAmount: number | null; targetCaseCount: number | null }[]
  }
  const { year, items } = body
  if (!year || !Number.isInteger(year) || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ success: false, error: '參數錯誤' }, { status: 400 })
  }

  // 範圍驗證：僅能設定自己管轄員工的目標
  const subordinates = await getSubordinates(session)
  const subIdSet = new Set(subordinates.map((s) => s.id))
  if (items.some((i) => !subIdSet.has(i.employeeId))) {
    return NextResponse.json({ success: false, error: '僅能設定管轄範圍內員工的目標' }, { status: 403 })
  }

  const setBy = parseInt(session.sub)
  const setAt = new Date()
  await prisma.$transaction(
    items.map((i) =>
      prisma.feeTarget.upsert({
        where: { employeeId_year: { employeeId: i.employeeId, year } },
        create: {
          employeeId: i.employeeId,
          year,
          targetAmount: i.targetAmount ?? null,
          targetCaseCount: i.targetCaseCount ?? null,
          setBy,
          setAt,
        },
        update: {
          targetAmount: i.targetAmount ?? null,
          targetCaseCount: i.targetCaseCount ?? null,
          setBy,
          setAt,
        },
      })
    )
  )

  return NextResponse.json({ success: true, data: { count: items.length } })
}
