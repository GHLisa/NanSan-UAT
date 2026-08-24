import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { splitFeeByRatio } from '@/lib/feeSplit'
import { getPrepaidTotals, getPrepayEventsInRange, type PrepayEvent } from '@/lib/feeRecognition'
import { prisma } from '@/lib/prisma'
import dayjs from 'dayjs'

const QUARTER_MONTHS: Record<string, number[]> = {
  Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9], Q4: [10,11,12],
}

// ── 依主辦人分組 ──────────────────────────────────────────────────────────
type CaseRow = {
  id: number; caseNumber: string; insuredName: string
  closeDate: string; actualFee: number; travelFee: number
  subtotalFee: number; remarks: string
}
// [2026/08/04] - Lisa - FR-109 季統計件數改「只計主辦」：
//   caseCount    ＝參與人次（同一案主辦＋協辦各計 1）→ 月統計明細小計／合計沿用
//   primaryCount ＝主辦件數（協辦不計）→ 季統計（當季表／YTD 累計表）使用
// 兩者並存而非改寫 caseCount，避免月統計小計與明細列數不符（明細是逐「人次」列）。
type EmpGroup = { empId: number; empName: string; cases: CaseRow[]; totals: { caseCount: number; primaryCount: number; actualFee: number; travelFee: number; subtotalFee: number } }

type RowAssignment = { employeeId: number; role: string; contributionRatio: number | null; employee: { name: string } }

// [2026/08/21] - Lisa - 公證費預付請款依出具日期認列：把「已決案結案淨額」與「預付請款認列」
// 兩種來源的金額，用同一套依承辦比例分攤＋累計小計的邏輯併入同一份 empMap，供月/季/YTD 共用。
function pushCaseRow(
  map: Map<number, EmpGroup>,
  input: {
    id: number; caseNumber: string; insuredName: string
    date: Date; amount: number; travelFee: number; remarks: string
    assignments: RowAssignment[]
  },
  visibleEmpIds: Set<number> | null,
  withCaseRows = true, // [2026/08/21] - Lisa - YTD 累計表僅需 totals 彙總，不列逐案明細（維持原行為）
) {
  const feeAmts = splitFeeByRatio(input.amount, input.assignments, x => x.contributionRatio ?? 0, x => x.role === '主辦')
  input.assignments.forEach((a, ai) => {
    if (visibleEmpIds && !visibleEmpIds.has(a.employeeId)) return // 組長：不列他組承辦人
    const actualFee = feeAmts[ai]
    const travelFee = a.role === '主辦' ? input.travelFee : 0
    const subtotalFee = actualFee + travelFee

    if (!map.has(a.employeeId)) {
      map.set(a.employeeId, {
        empId: a.employeeId,
        empName: a.employee.name,
        cases: [],
        totals: { caseCount: 0, primaryCount: 0, actualFee: 0, travelFee: 0, subtotalFee: 0 },
      })
    }
    const group = map.get(a.employeeId)!
    if (withCaseRows) {
      group.cases.push({
        id: input.id,
        caseNumber: input.caseNumber,
        insuredName: input.insuredName,
        closeDate: input.date.toISOString(),
        actualFee,
        travelFee,
        subtotalFee,
        remarks: input.remarks,
      })
    }
    group.totals.caseCount++
    if (a.role === '主辦') group.totals.primaryCount++
    group.totals.actualFee += actualFee
    group.totals.travelFee += travelFee
    group.totals.subtotalFee += subtotalFee
  })
}

// 預付請款事件的備註（承辦部門標記＋分工比例）與案件顯示欄位，需另外查案件基本資料
// （案件可能尚未結案，不在已決案件清單內）。
async function pushPrepayEvents(
  map: Map<number, EmpGroup>,
  events: PrepayEvent[],
  refDeptId: number | null,
  visibleEmpIds: Set<number> | null,
  withCaseRows = true,
) {
  const caseIds = [...new Set(events.map((e) => e.caseId))]
  if (caseIds.length === 0) return
  const caseInfos = await prisma.case.findMany({
    where: { id: { in: caseIds } },
    select: { id: true, caseNumber: true, insuredName: true, departmentId: true, department: { select: { name: true } } },
  })
  const caseInfoMap = new Map(caseInfos.map((c) => [c.id, c]))

  for (const e of events) {
    const info = caseInfoMap.get(e.caseId)
    if (!info) continue
    const ratioText = e.assignments.length > 1
      ? e.assignments.map((a) => `${a.employee.name} ${Math.round((a.contributionRatio ?? 0) * 100)}%`).join('/')
      : ''
    const deptTag = refDeptId && info.departmentId !== refDeptId ? `[${info.department.name}]` : ''
    const remarks = [deptTag, '公證費預付請款', ratioText].filter(Boolean).join(' ')
    pushCaseRow(
      map,
      {
        id: info.id,
        caseNumber: info.caseNumber,
        insuredName: info.insuredName,
        date: e.issuedAt,
        amount: e.amount,
        travelFee: 0,
        remarks,
        assignments: e.assignments,
      },
      visibleEmpIds,
      withCaseRows,
    )
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const type    = searchParams.get('type') ?? 'monthly'  // 'monthly' | 'quarterly'
  const year    = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()))
  const month   = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1))
  const quarter = searchParams.get('quarter') ?? 'Q1'
  const deptId  = searchParams.get('deptId') ? parseInt(searchParams.get('deptId')!) : null
  const empId   = parseInt(session.sub)
  const { role, departmentId, teamGroup } = session
  // [2026/08/04] - Lisa - 新增「統計範圍」切換（FR-107）：
  //   'dept'（預設）＝限案件承辦部門：只納入案屬本單位的案件，顯示列仍僅本單位人員
  //   'share'        ＝含本單位人員於他部門協辦之案件（v3.11/FR-104 原行為），僅列其份額
  // 承辦人不適用（一律不限部門、僅自己），故不受此參數影響。
  const scopeMode = searchParams.get('scopeMode') === 'share' ? 'share' : 'dept'
  // [2026/08/04] - Lisa - FR-107：備註僅標註「非本單位」之案件承辦部門。
  // 比對基準：副總/行政/系統管理員＝下拉所選部門（選「全部部門」時無基準，一律不標）；
  // 其餘角色（承辦人/組長/部門主管）＝當前角色所屬部門。
  const refDeptId = (canViewAllDepts(role) || role === 'admin_staff') ? deptId : departmentId

  // ── closeDate 範圍 ─────────────────────────────────────────────────────
  let closeDateWhere: { gte: Date; lte: Date }
  if (type === 'monthly') {
    const start = dayjs(`${year}-${String(month).padStart(2,'0')}-01`)
    closeDateWhere = { gte: start.toDate(), lte: start.endOf('month').toDate() }
  } else {
    const months = QUARTER_MONTHS[quarter] ?? [1,2,3]
    const m1 = months[0], m2 = months[months.length - 1]
    closeDateWhere = {
      gte: dayjs(`${year}-${String(m1).padStart(2,'0')}-01`).toDate(),
      lte: dayjs(`${year}-${String(m2).padStart(2,'0')}-01`).endOf('month').toDate(),
    }
  }

  // ── 角色可見範圍 WHERE ─────────────────────────────────────────────────
  // [2026/08/21] - Lisa - roleScopeWhere 不含 status/closeDate，供「公證費預付請款」查詢
  // （不限案件是否已結案）沿用同一套角色可視範圍邏輯；scopeWhere 為已決案件查詢專用（疊加 status/closeDate）。
  const roleScopeWhere: Record<string, unknown> = {}
  // [2026/07/28] - Lisa - 可顯示的承辦人（null = 不限）：組長僅列同組同事，
  // 他組承辦人的分攤列不顯示（分攤金額仍以案件全部承辦人為計算基準，個人份額不受影響）
  let visibleEmpIds: Set<number> | null = null
  if (role === 'handler') {
    // [2026/07/28] - Lisa - 承辦人不限部門：可能於他部門協辦，加部門條件會漏掉跨部門協辦案
    //（對齊 api/cases Issue #5 的處理）；且僅列自己的分攤列，不顯示共同承辦人的列
    roleScopeWhere.assignments = { some: { employeeId: empId } }
    visibleEmpIds = new Set([empId])
  } else if (canViewAllDepts(role) || role === 'admin_staff') {
    // [2026/07/07] - Lisa - 行政人員比照副總：全公司範圍，可依部門查詢條件篩選
    // [2026/08/04] - Lisa - FR-107：選定部門時可切換範圍定義；未選部門（全部部門）時兩者等價，不做處理
    if (deptId) {
      if (scopeMode === 'share') {
        // 該部門人員（主要角色）有參與之案件（不限案件承辦部門），僅列該部門人員的分攤列
        const roles = await prisma.employeeRole.findMany({
          where: { departmentId: deptId, isPrimary: true },
          select: { employeeId: true },
        })
        const ids = [...new Set(roles.map((r) => r.employeeId))]
        roleScopeWhere.assignments = { some: { employeeId: { in: ids } } }
        visibleEmpIds = new Set(ids)
      } else {
        // 限案件承辦部門：維持原行為（案屬該部門、列全部承辦人，部門合計完整）
        roleScopeWhere.departmentId = deptId
      }
    }
  } else if (role === 'team_lead' && departmentId && teamGroup) {
    // [2026/07/28] - Lisa - 組長：以「同組人員（同部門＋同組別，主要角色）的參與」為準，不限案件承辦部門，
    // 使同組人員在他部門協辦的份額也納入（與部門主管同一套邏輯）；顯示列僅限同組人員。
    // 註：案件管理清單（api/cases buildCaseScope，FR-34）仍維持「案屬本部門」的限制，兩者定義不同——
    // 本報表算的是「本組人員的份額」，非「本部門的案件」。
    const roles = await prisma.employeeRole.findMany({
      where: { departmentId, teamGroup, isPrimary: true },
      select: { employeeId: true },
    })
    const groupEmpIds = [...new Set(roles.map((r) => r.employeeId))]
    roleScopeWhere.assignments = { some: { employeeId: { in: groupEmpIds } } }
    visibleEmpIds = new Set(groupEmpIds)
    // [2026/08/04] - Lisa - FR-107：'dept' 模式再加上「案屬本部門」限制（顯示列仍僅同組人員）
    if (scopeMode === 'dept') roleScopeWhere.departmentId = departmentId
  } else if (departmentId) {
    // 組長無組別 / 部門主管
    // [2026/07/28] - Lisa - 範圍改以「本部門人員的參與」為準（不再限案件承辦部門），
    // 使本部門人員在他部門協辦的份額也納入；顯示列仍僅限本部門人員（跨部門協辦者不顯示）。
    // 人員認定採「主要角色（isPrimary）所屬部門」：兼任他部門主管者（如同時掛兩部門主管）
    // 其本職案件應歸主要部門，否則會被重複計入兩個部門的報表。
    const roles = await prisma.employeeRole.findMany({
      where: { departmentId, isPrimary: true },
      select: { employeeId: true },
    })
    const deptEmpIds = [...new Set(roles.map((r) => r.employeeId))]
    roleScopeWhere.assignments = { some: { employeeId: { in: deptEmpIds } } }
    visibleEmpIds = new Set(deptEmpIds)
    // [2026/08/04] - Lisa - FR-107：'dept' 模式再加上「案屬本部門」限制（顯示列仍僅本部門人員）
    if (scopeMode === 'dept') roleScopeWhere.departmentId = departmentId
  }

  const scopeWhere: Record<string, unknown> = { status: '已決', closeDate: closeDateWhere, ...roleScopeWhere }

  // ── 取得已決案件 ─────────────────────────────────────────────────────────
  const cases = await prisma.case.findMany({
    where: scopeWhere,
    select: {
      id: true,
      caseNumber: true,
      insuredName: true,
      closeDate: true,
      actualFee: true,
      travelOtherExpense: true,
      notes: true,
      // [2026/08/04] - Lisa - FR-107：備註欄標記案件承辦部門（僅非本單位案件）
      departmentId: true,
      department: { select: { name: true } },
      assignments: {
        select: {
          employeeId: true,
          role: true,
          contributionRatio: true,
          employee: { select: { name: true } },
        },
      },
    },
    orderBy: { closeDate: 'asc' },
  })

  // [2026/08/21] - Lisa - 已決案結案月淨額＝actualFee − 該案累計已依出具日期認列的公證費預付請款，
  // 避免預付金額在出具當月與結案月被重複計入（可能為負，代表多預付／結案下修）。
  const prepaidTotals = await getPrepaidTotals(cases.map((c) => c.id))

  const empMap = new Map<number, EmpGroup>()

  // [2026/07/14] - Lisa - 純公證費/差旅其他費/小計依承辦比例分配；每位經辦人（主辦＋協辦）各列其份額，同一案分列各人，件數依參與人計
  for (const c of cases) {
    const travelFeeFull = c.travelOtherExpense ?? 0
    const actualFeeFull = (c.actualFee ?? 0) - (prepaidTotals.get(c.id) ?? 0)

    // 備註：非本單位案件標記其承辦部門＋多位承辦人時顯示分工比例
    // [2026/08/04] - Lisa - FR-107：僅「非本單位」之案件加 [承辦部門]，讓跨部門協辦案一眼可辨
    const ratioText = c.assignments.length > 1
      ? c.assignments.map(a => `${a.employee.name} ${Math.round((a.contributionRatio ?? 0) * 100)}%`).join('/')
      : ''
    const deptTag = refDeptId && c.departmentId !== refDeptId ? `[${c.department.name}]` : ''
    const remarks = [deptTag, ratioText].filter(Boolean).join(' ')

    pushCaseRow(
      empMap,
      {
        id: c.id,
        caseNumber: c.caseNumber,
        insuredName: c.insuredName,
        date: c.closeDate!,
        amount: actualFeeFull,
        travelFee: travelFeeFull,
        remarks,
        assignments: c.assignments,
      },
      visibleEmpIds,
    )
  }

  // [2026/08/21] - Lisa - 公證費預付請款：依出具日期併入同一期間的統計（不限案件是否已結案）
  const prepayEvents = await getPrepayEventsInRange(roleScopeWhere as unknown as Prisma.CaseWhereInput, closeDateWhere)
  await pushPrepayEvents(empMap, prepayEvents, refDeptId, visibleEmpIds)

  const groups = Array.from(empMap.values())

  const grandTotals = groups.reduce(
    (s, g) => ({
      caseCount: s.caseCount + g.totals.caseCount,
      primaryCount: s.primaryCount + g.totals.primaryCount, // [2026/08/04] - Lisa - FR-109
      actualFee: s.actualFee + g.totals.actualFee,
      travelFee: s.travelFee + g.totals.travelFee,
      subtotalFee: s.subtotalFee + g.totals.subtotalFee,
    }),
    { caseCount: 0, primaryCount: 0, actualFee: 0, travelFee: 0, subtotalFee: 0 }
  )

  // ── 季統計：計算 YTD ─────────────────────────────────────────────────────
  let ytdGroups: EmpGroup[] | null = null
  if (type === 'quarterly') {
    const qMonths = QUARTER_MONTHS[quarter] ?? [1,2,3]
    const ytdEndMonth = qMonths[qMonths.length - 1]
    const ytdStart = new Date(`${year}-01-01`)
    const ytdEnd = dayjs(`${year}-${String(ytdEndMonth).padStart(2,'0')}-01`).endOf('month')
    const ytdRange = { gte: ytdStart, lte: ytdEnd.toDate() }

    const ytdCases = await prisma.case.findMany({
      where: {
        ...scopeWhere,
        closeDate: ytdRange,
      },
      select: {
        id: true,
        caseNumber: true,
        insuredName: true,
        closeDate: true,
        actualFee: true,
        travelOtherExpense: true,
        departmentId: true, // [2026/08/21] - Lisa - 與主查詢欄位一致（remarks 部門標記用）
        department: { select: { name: true } },
        assignments: {
          select: { employeeId: true, role: true, contributionRatio: true, employee: { select: { name: true } } },
        },
      },
    })

    const ytdPrepaidTotals = await getPrepaidTotals(ytdCases.map((c) => c.id))

    const ytdMap = new Map<number, EmpGroup>()
    for (const c of ytdCases) {
      const travelFeeFull = c.travelOtherExpense ?? 0
      const actualFeeFull = (c.actualFee ?? 0) - (ytdPrepaidTotals.get(c.id) ?? 0)
      const ratioText = c.assignments.length > 1
        ? c.assignments.map(a => `${a.employee.name} ${Math.round((a.contributionRatio ?? 0) * 100)}%`).join('/')
        : ''
      const deptTag = refDeptId && c.departmentId !== refDeptId ? `[${c.department.name}]` : ''
      const remarks = [deptTag, ratioText].filter(Boolean).join(' ')
      pushCaseRow(
        ytdMap,
        {
          id: c.id,
          caseNumber: c.caseNumber,
          insuredName: c.insuredName,
          date: c.closeDate!,
          amount: actualFeeFull,
          travelFee: travelFeeFull,
          remarks,
          assignments: c.assignments,
        },
        visibleEmpIds,
        false, // YTD 累計表僅需彙總，不列逐案明細（維持原行為）
      )
    }

    const ytdPrepayEvents = await getPrepayEventsInRange(roleScopeWhere as unknown as Prisma.CaseWhereInput, ytdRange)
    await pushPrepayEvents(ytdMap, ytdPrepayEvents, refDeptId, visibleEmpIds, false)

    ytdGroups = Array.from(ytdMap.values())
  }

  return NextResponse.json({
    success: true,
    data: { type, year, month, quarter, scopeMode, groups, grandTotals, ytdGroups },
  })
}
