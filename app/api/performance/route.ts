import { NextRequest, NextResponse } from 'next/server'
import { getSession, JWTPayload } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { splitFeeByRatio } from '@/lib/feeSplit'
import dayjs from 'dayjs'
import { taipeiNow } from '@/lib/sla'

// ── 可設定對象（對齊 demo FeeTargetPage subordinates）─────────────────────
// team_lead：同部門同組別的承辦人；dept_manager：本部門承辦人＋組長；其餘角色無對象
// [2026/07/28] - Lisa - 擴大可設定對象：組長納入組長、部門主管納入部門主管、vp／行政人員／系統管理員可設定全公司
// team_lead：同部門同組別的承辦人＋組長
// dept_manager：本部門承辦人＋組長＋部門主管
// vp／admin_staff／sysadmin：全公司承辦人＋組長＋部門主管（不分部門）
const TARGET_ROLES = ['handler', 'team_lead', 'dept_manager']
const COMPANY_WIDE_ROLES = ['vp', 'admin_staff', 'sysadmin']
// [2026/07/30] - Lisa - 行政人員改為唯讀：可檢視全公司業績目標（GET 仍走 COMPANY_WIDE_ROLES），
// 但不得設定；寫入角色改由本清單把關（不含 admin_staff／handler）
const CAN_SET_ROLES = ['team_lead', 'dept_manager', 'vp', 'sysadmin']

// [2026/08/19] - Lisa - 歷史年度目標查詢新增季目標統計：依累計季度換算目標與達成率
// Q1～Q4 為累計（Q1~Q3＝1~9月），非單一季度
const QUARTER_END_MONTH: Record<string, number> = { 'Q1': 3, 'Q1~Q2': 6, 'Q1~Q3': 9, 'Q1~Q4': 12 }
const QUARTER_COUNT: Record<string, number> = { 'Q1': 1, 'Q1~Q2': 2, 'Q1~Q3': 3, 'Q1~Q4': 4 }

async function getSubordinates(session: JWTPayload) {
  let roleWhere: Record<string, unknown> | null = null
  // [2026/07/28] - Lisa - 承辦人：僅本人一筆（唯讀查看自己的目標與達成；寫入由 POST 角色驗證擋掉）
  if (session.role === 'handler') {
    roleWhere = { employeeId: parseInt(session.sub) }
  } else if (session.role === 'team_lead' && session.departmentId) {
    roleWhere = { departmentId: session.departmentId, teamGroup: session.teamGroup, role: { in: ['handler', 'team_lead'] } }
  } else if (session.role === 'dept_manager' && session.departmentId) {
    roleWhere = { departmentId: session.departmentId, role: { in: TARGET_ROLES } }
  } else if (COMPANY_WIDE_ROLES.includes(session.role)) {
    roleWhere = { role: { in: TARGET_ROLES } }
  }
  if (!roleWhere) return []

  // [2026/07/28] - Lisa - 一併帶回部門／組別，並依「部門代碼→組別→員工 ID」排序
  const roles = await prisma.employeeRole.findMany({
    where: { ...roleWhere, employee: { isActive: true } },
    select: {
      employeeId: true,
      teamGroup: true,
      isPrimary: true,
      employee: { select: { name: true } },
      department: { select: { name: true, code: true } },
    },
  })

  // 業績目標為「一員工一年一筆」，故跨部門／跨組別兼職者只取一筆（主要角色 isPrimary 優先）
  const byEmployee = new Map<
    number,
    { id: number; name: string; departmentName: string; departmentCode: string; teamGroup: string | null; isPrimary: boolean }
  >()
  for (const r of roles) {
    const prev = byEmployee.get(r.employeeId)
    if (prev && !(r.isPrimary && !prev.isPrimary)) continue
    byEmployee.set(r.employeeId, {
      id: r.employeeId,
      name: r.employee.name,
      departmentName: r.department?.name ?? '',
      departmentCode: r.department?.code ?? '',
      teamGroup: r.teamGroup,
      isPrimary: r.isPrimary,
    })
  }

  return [...byEmployee.values()].sort(
    (a, b) =>
      a.departmentCode.localeCompare(b.departmentCode) ||
      (a.teamGroup ?? '').localeCompare(b.teamGroup ?? '') ||
      a.id - b.id
  )
}

// ── 年度實績：closeDate 為該年度的案件，依貢獻比例分攤 actualFee ───────────
// 對齊 demo calcActualFee / calcActualCaseCount
// [2026/08/04] - Lisa - FR-110 fee＝依比例分攤的份額；count＝**只計主辦**的案件數
// [2026/08/19] - Lisa - quarterEndMonth：限縮 closeDate 月份（1~該月），供歷史查詢季目標統計換算；預設 12（全年，Q1~Q4）
async function calcActuals(empIds: number[], years: number[], quarterEndMonth = 12) {
  const map = new Map<string, { fee: number; count: number }>()
  if (empIds.length === 0 || years.length === 0) return map

  const minYear = Math.min(...years)
  const maxYear = Math.max(...years)
  const closedCases = await prisma.case.findMany({
    where: { closeDate: { gte: new Date(`${minYear}-01-01`), lt: new Date(`${maxYear + 1}-01-01`) } },
    select: {
      closeDate: true,
      actualFee: true,
      assignments: { select: { employeeId: true, role: true, contributionRatio: true } },
    },
  })

  const yearSet = new Set(years)
  const empSet = new Set(empIds)
  for (const c of closedCases) {
    const year = dayjs(c.closeDate).year()
    if (!yearSet.has(year)) continue
    if (dayjs(c.closeDate).month() + 1 > quarterEndMonth) continue
    // 依承辦比例分攤 actualFee（非主辦捨去、主辦吸收剩餘）
    const amts = c.actualFee
      ? splitFeeByRatio(c.actualFee, c.assignments, a => a.contributionRatio ?? 1, a => a.role === '主辦')
      : null
    c.assignments.forEach((a, i) => {
      if (!empSet.has(a.employeeId)) return
      const key = `${a.employeeId}-${year}`
      const entry = map.get(key) ?? { fee: 0, count: 0 }
      // [2026/08/04] - Lisa - FR-110 件數只計主辦（協辦不計件，惟金額份額仍計）。
      // 與已決案明細表季統計（FR-109）、儀表板結案件數達成率同一口徑。
      if (a.role === '主辦') entry.count += 1
      if (amts) entry.fee += amts[i]
      map.set(key, entry)
    })
  }
  return map
}

// ── 庫存：未決案件的預估公證費（依貢獻比例分攤）與件數 ─────────────────────
// 對齊 demo calcInventoryFee / calcInventoryCaseCount
// [2026/08/04] - Lisa - FR-110 fee＝依比例分攤的份額；count＝**只計主辦**的未決案件數
async function calcInventory(empIds: number[]) {
  const map = new Map<number, { fee: number; count: number }>()
  if (empIds.length === 0) return map

  const openCases = await prisma.case.findMany({
    where: { status: '未決' },
    select: {
      estimatedFee: true,
      assignments: { select: { employeeId: true, role: true, contributionRatio: true } },
    },
  })

  const empSet = new Set(empIds)
  for (const c of openCases) {
    // 依承辦比例分攤 estimatedFee（非主辦捨去、主辦吸收剩餘）
    const amts = splitFeeByRatio(c.estimatedFee ?? 0, c.assignments, a => a.contributionRatio ?? 1, a => a.role === '主辦')
    c.assignments.forEach((a, i) => {
      if (!empSet.has(a.employeeId)) return
      const entry = map.get(a.employeeId) ?? { fee: 0, count: 0 }
      // [2026/08/04] - Lisa - FR-110 庫存件數同樣只計主辦，與同頁實績件數口徑一致
      if (a.role === '主辦') entry.count += 1
      entry.fee += amts[i]
      map.set(a.employeeId, entry)
    })
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
    // [2026/08/19] - Lisa - 季目標統計：quarter＝累計季度（Q1／Q1~Q2／Q1~Q3／Q1~Q4，預設全年）
    // 目標與達成率換算＝原年度目標 / 4 * 季數；實績亦限縮至該累計月份區間，兩者口徑一致
    const quarterParam = req.nextUrl.searchParams.get('quarter') ?? 'Q1~Q4'
    const quarter = QUARTER_END_MONTH[quarterParam] ? quarterParam : 'Q1~Q4'
    const quarterEndMonth = QUARTER_END_MONTH[quarter]
    const quarterCount = QUARTER_COUNT[quarter]

    const targets = await prisma.feeTarget.findMany({
      where: { employeeId: { in: subIds } },
      include: {
        employee: { select: { name: true } },
        setter: { select: { name: true } },
      },
      orderBy: [{ year: 'desc' }, { employeeId: 'asc' }],
    })
    const actuals = await calcActuals(subIds, [...new Set(targets.map((t) => t.year))], quarterEndMonth)
    // [2026/07/28] - Lisa - 歷史查詢亦顯示部門／組別，排序為年度（新→舊）→部門→組別→員工
    const empMap = new Map(subordinates.map((s) => [s.id, s]))
    const empOrder = new Map(subordinates.map((s, i) => [s.id, i]))

    return NextResponse.json({
      success: true,
      data: targets
        .map((t) => {
          const actual = actuals.get(`${t.employeeId}-${t.year}`)
          const emp = empMap.get(t.employeeId)
          return {
            id: t.id,
            employeeId: t.employeeId,
            employeeName: t.employee.name,
            departmentName: emp?.departmentName ?? '',
            teamGroup: emp?.teamGroup ?? null,
            year: t.year,
            targetAmount: t.targetAmount != null ? Math.round((t.targetAmount / 4) * quarterCount) : null,
            targetCaseCount: t.targetCaseCount != null ? Math.round((t.targetCaseCount / 4) * quarterCount) : null,
            actualFee: actual?.fee ?? 0,
            actualCaseCount: actual?.count ?? 0,
            setByName: t.setter.name,
            setAt: t.setAt.toISOString(),
          }
        })
        .sort(
          (a, b) =>
            b.year - a.year ||
            (empOrder.get(a.employeeId) ?? 0) - (empOrder.get(b.employeeId) ?? 0)
        ),
    })
  }

  // ── 年度目標設定（含前一年參考值／實績與庫存）──────────────────────────
  // [2026/08/05] - Lisa - 預設年度取台北時間（伺服器 UTC 於元旦台北 00:00~08:00 會落在去年）
  const year = parseInt(req.nextUrl.searchParams.get('year') ?? String(taipeiNow().year()))
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
      employees: subordinates.map((e) => ({
        id: e.id,
        name: e.name,
        departmentName: e.departmentName,
        teamGroup: e.teamGroup,
      })),
      rows: subordinates.map((e) => {
        const cur = targetMap.get(`${e.id}-${year}`)
        const ref = targetMap.get(`${e.id}-${refYear}`)
        const refActual = refActuals.get(`${e.id}-${refYear}`)
        const inv = inventory.get(e.id)
        return {
          employeeId: e.id,
          name: e.name,
          departmentName: e.departmentName,
          teamGroup: e.teamGroup,
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
  // [2026/07/28] - Lisa - 開放 vp／行政人員／系統管理員設定（全公司範圍）
  // [2026/07/30] - Lisa - 行政人員改唯讀，自寫入角色移除（僅 team_lead／dept_manager／vp／sysadmin 可設定）
  if (!CAN_SET_ROLES.includes(session.role)) {
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
