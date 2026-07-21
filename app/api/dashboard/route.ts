import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { splitFeeByRatio } from '@/lib/feeSplit'
import { buildCaseScopeWhere, getCaseScopeLabel, getScopeEmployeeIds } from '@/lib/caseScope'
import { buildReviewWhere, defaultReviewTab } from '@/lib/reviewScope'
import type { Prisma } from '@prisma/client'
import dayjs from 'dayjs'

// SLA status: red = >30d no prelim OR >90d open; yellow = >14d no prelim
function getSlaStatus(commissionDate: Date, preliminaryReportDate: Date | null, status: string): 'red' | 'yellow' | 'normal' {
  if (status !== '未決') return 'normal'
  const daysSince = dayjs().diff(dayjs(commissionDate), 'day')
  if (!preliminaryReportDate && daysSince >= 30) return 'red'
  if (daysSince >= 90) return 'red'
  if (!preliminaryReportDate && daysSince >= 14) return 'yellow'
  return 'normal'
}

// [2026/06/18] - Lisa - Issue #1 退回重送仍顯示於待辦 / Issue #6 納入協辦案件 - Start
// 承辦人「退回待修」僅保留仍需修正的退回紀錄：同 caseId+documentType 若已重新送件
// （產生較新的審核紀錄），舊退回視為已處理而排除。判定＝該群組最新一筆送審即為自己。
// Issue #6：改以「案件指派」判定（主辦或協辦），不論送審人是誰、不限部門，
//   讓協辦者也能看到夥伴送審後被退回的文件。
// 純查詢端過濾，保留全部退回歷史紀錄供稽核（FSD §4.2.17 v3.3 補述）。
async function getActiveReturnedReviewIds(empId: number): Promise<number[]> {
  // [2026/06/18] - Lisa - Issue #11 退回待修涵蓋全關卡退回（與案件清單「退件」一致）- Start
  // 退回可能發生於主管複核 / 加簽審核 / 執行副總任一關卡；三者皆視為「退回待修」
  const returned = await prisma.caseReview.findMany({
    where: {
      OR: [{ reviewStatus: '退回' }, { midApprovalStatus: '退回' }, { approvalStatus: '退回' }],
      // [2026/06/18] - Lisa - 方案1/2 排除已重送/已放棄（終結）紀錄
      recordStatus: null,
      case: { assignments: { some: { employeeId: empId } } },
    },
    select: { id: true, caseId: true, documentType: true, submittedAt: true },
  })
  // [2026/06/18] - Lisa - Issue #11 退回待修涵蓋全關卡退回 - end
  if (returned.length === 0) return []

  // 撈出這些案件的所有審核紀錄，計算各 (caseId|documentType) 群組的最新送審時間
  const caseIds = [...new Set(returned.map(r => r.caseId))]
  const allReviews = await prisma.caseReview.findMany({
    where: { caseId: { in: caseIds } },
    select: { caseId: true, documentType: true, submittedAt: true },
  })
  const latestByGroup = new Map<string, Date>()
  for (const r of allReviews) {
    const key = `${r.caseId}|${r.documentType}`
    const cur = latestByGroup.get(key)
    if (!cur || r.submittedAt > cur) latestByGroup.set(key, r.submittedAt)
  }

  // 僅保留「自己即為該群組最新一筆送審」的退回紀錄
  return returned
    .filter(r => {
      const latest = latestByGroup.get(`${r.caseId}|${r.documentType}`)
      return !latest || r.submittedAt >= latest
    })
    .map(r => r.id)
}
// [2026/06/18] - Lisa - Issue #1 退回重送仍顯示於待辦 / Issue #6 納入協辦案件 - end

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const empId = parseInt(session.sub)
  // FR-19 v2.1/v2.3 角色可視範圍（共用 helper）
  const caseScope = getCaseScopeLabel(session)
  const feeScope = caseScope
  const currentYear = dayjs().year()
  const today = dayjs()
  const yearStart = new Date(`${currentYear}-01-01`)
  const yearEnd = new Date(`${currentYear + 1}-01-01`)

  // ── 審核角色待辦範圍：一律改用共用的 buildReviewWhere，與 /api/reviews
  //    清單及導覽列 badge 完全一致（依登入者部門角色限縮，非僅 reviewerId）。
  //    buildReviewWhere 為純函式（僅依 session、不查 DB），可於 Wave 1 前同步建立。
  const isReviewerRole =
    session.role === 'team_lead' || session.role === 'dept_manager' || session.role === 'vp'
  const reviewerScopeWhere: Prisma.CaseReviewWhereInput | null =
    isReviewerRole ? buildReviewWhere(session, defaultReviewTab(session.role)) : null

  // ── [效能] Wave 1：僅依賴 session 的查詢一次平行發出 ─────────────────────
  // 原本 caseWhere / scope / 退回 id / 待辦計數 為逐筆 await，於遠端 DB 下每趟
  // 約 200ms 串接疊加；改為單批 Promise.all 後僅付一趟往返時間。
  // 待辦計數（非承辦人）為與 caseWhere 無關的 count，可同批平行。
  const pendingCountQuery: Promise<number> =
    reviewerScopeWhere
      ? prisma.caseReview.count({ where: reviewerScopeWhere })
      : session.role === 'admin_staff'
        ? prisma.dispatchQueue.count({
            where: { status: '待取件', ...(session.departmentId ? { assignedDepartmentId: session.departmentId } : {}) },
          })
        : Promise.resolve(0) // handler 由 activeReturnedIds 決定；sysadmin 無待辦計數

  const [caseWhere, scopeEmpIds, activeReturnedIds, pendingCountBase] = await Promise.all([
    buildCaseScopeWhere(session),
    getScopeEmployeeIds(session),
    // [2026/06/18] - Lisa - Issue #1 承辦人退回待修：排除已重送後的退回 id（KPI 與待辦清單共用）
    session.role === 'handler' ? getActiveReturnedReviewIds(empId) : Promise.resolve([] as number[]),
    pendingCountQuery,
  ])
  const scopeEmpIdSet = new Set(scopeEmpIds)

  // ── 待辦計數 / 標籤（role-based）────────────────────────────────────────
  const pendingCount = session.role === 'handler' ? activeReturnedIds.length : pendingCountBase
  const pendingLabel =
    session.role === 'handler' ? '退回待修'
      : session.role === 'team_lead' || session.role === 'dept_manager' ? '待主管複核'
        : session.role === 'vp' ? '待執行副總閱示'
          : session.role === 'admin_staff' ? '待取件派案'
            : '待辦'

  // ── 待辦清單 where（依角色）────────────────────────────────────────────
  // 承辦人＝退回待修（特殊語意，保留 id 清單）；審核角色＝共用 buildReviewWhere
  // （與計數同一來源，確保部門角色限縮一致、件數與清單相符）。
  let reviewWhere: Prisma.CaseReviewWhereInput = {}
  if (session.role === 'handler') reviewWhere = { id: { in: activeReturnedIds } }
  else if (reviewerScopeWhere) reviewWhere = reviewerScopeWhere

  const expiryThreshold = today.subtract(2, 'year').add(30, 'day').toDate()
  const sixMonthsAgo = today.subtract(5, 'month').startOf('month')

  // ── [效能] Wave 2：依賴 caseWhere / scopeEmpIds / reviewWhere 的查詢全部平行 ──
  const [
    openCount,
    yearlySettlements,
    yearTargets,
    yearClosedCases,
    pendingReviewRows,
    openCases,
    statuteWarnings,
    newCasesByMonth,
    closedByMonth,
    stageDistribution,
  ] = await Promise.all([
    // Open case count (scoped)
    prisma.case.count({ where: { ...caseWhere, status: '未決' } }),
    // Yearly settlements (scoped)
    prisma.settlement.findMany({
      where: { reportDate: { gte: yearStart, lt: yearEnd }, case: { ...caseWhere } },
      select: { baseFee: true, splits: { select: { employeeId: true, amount: true, ratio: true } } },
    }),
    // 目標值＝scope 員工的 feeTarget（無 scope 員工時為空）
    scopeEmpIds.length
      ? prisma.feeTarget.findMany({
          where: { employeeId: { in: scopeEmpIds }, year: currentYear },
          select: { targetAmount: true, targetCaseCount: true },
        })
      : Promise.resolve([] as { targetAmount: number | null; targetCaseCount: number | null }[]),
    // 年度已決案件（依貢獻比例分攤 actualFee）
    prisma.case.findMany({
      where: { ...caseWhere, status: '已決', closeDate: { gte: yearStart, lt: yearEnd, not: null } },
      select: {
        id: true,
        actualFee: true,
        assignments: { select: { employeeId: true, role: true, contributionRatio: true } },
      },
    }),
    // 待辦清單
    prisma.caseReview.findMany({
      where: reviewWhere,
      include: {
        case: {
          select: {
            caseNumber: true,
            insuredName: true,
            assignments: { where: { role: '主辦' }, include: { employee: { select: { name: true } } }, take: 1 },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
      take: 5,
    }),
    // 未決案件（SLA 預警來源）
    prisma.case.findMany({
      where: { ...caseWhere, status: '未決' },
      select: {
        id: true, caseNumber: true, insuredName: true, commissionDate: true,
        preliminaryReportDate: true, currentStage: true,
        assignments: { where: { role: '主辦' }, include: { employee: { select: { name: true } } }, take: 1 },
      },
    }),
    // 時效預警（請求權 2 年內 30 天到期）
    prisma.case.findMany({
      where: { ...caseWhere, status: '未決', commissionDate: { lte: expiryThreshold } },
      select: {
        id: true, caseNumber: true, insuredName: true, commissionDate: true,
        assignments: { where: { role: '主辦' }, include: { employee: { select: { name: true } } }, take: 1 },
      },
      orderBy: { commissionDate: 'asc' },
      take: 8, // 比照 SLA 預警上限，避免大量資料拖慢儀表板
    }),
    // 月趨勢：新受理
    prisma.case.groupBy({
      by: ['commissionDate'],
      where: { ...caseWhere, commissionDate: { gte: sixMonthsAgo.toDate() } },
      _count: { id: true },
    }),
    // 月趨勢：已結案
    prisma.case.groupBy({
      by: ['closeDate'],
      where: { ...caseWhere, status: '已決', closeDate: { gte: sixMonthsAgo.toDate(), not: null } },
      _count: { id: true },
    }),
    // 關卡分布
    prisma.case.groupBy({
      by: ['currentStage'],
      where: { ...caseWhere, status: '未決' },
      _count: { id: true },
    }),
  ])

  // ── Yearly fee (scoped) ────────────────────────────────────────────────
  let yearlyFee = 0
  if (session.role === 'handler') {
    yearlyFee = yearlySettlements.reduce((sum, s) => {
      const split = s.splits.find(sp => sp.employeeId === empId)
      return sum + (split?.amount ?? 0)
    }, 0)
  } else {
    yearlyFee = yearlySettlements.reduce((sum, s) => sum + s.baseFee, 0)
  }

  // ── Fee achievement rate (FR-19，依角色 scope 內員工彙總，對齊 demo) ───────
  // 目標值＝scope 員工的 feeTarget 加總（無任何目標時為 null）
  const feeTarget = yearTargets.length
    ? yearTargets.reduce((s, t) => s + (t.targetAmount ?? 0), 0)
    : null
  const countTarget = yearTargets.length
    ? yearTargets.reduce((s, t) => s + (t.targetCaseCount ?? 0), 0)
    : null

  // 實際值＝scope 內案件年度已決公證費（依貢獻比例分攤 actualFee）
  // 結案件數分母＝scope 內 closeDate 為今年的已決案件數（非 settlements.length）
  let actualFeePure = 0
  let actualClosedCount = 0
  for (const c of yearClosedCases) {
    const inScope = c.assignments.some(a => scopeEmpIdSet.has(a.employeeId))
    if (!inScope) continue
    actualClosedCount += 1
    if (c.actualFee) {
      // 依承辦比例分攤（非主辦捨去、主辦吸收剩餘），僅加總 scope 內承辦人份額
      const amts = splitFeeByRatio(c.actualFee, c.assignments, a => a.contributionRatio ?? 1, a => a.role === '主辦')
      actualFeePure += c.assignments.reduce(
        (s, a, i) => (scopeEmpIdSet.has(a.employeeId) ? s + amts[i] : s),
        0,
      )
    }
  }

  const feeAchieveRate = feeTarget ? Math.min(Math.round(actualFeePure / feeTarget * 100), 999) : null
  const countAchieveRate = countTarget ? Math.min(Math.round(actualClosedCount / countTarget * 100), 999) : null

  // ── Pending reviews list ──────────────────────────────────────────────
  const pendingReviews = pendingReviewRows.map(r => ({
    id: r.id,
    caseId: r.caseId,
    caseNumber: r.case.caseNumber,
    insuredName: r.case.insuredName,
    handlerName: r.case.assignments[0]?.employee.name ?? '—',
    documentType: r.documentType,
    reviewStatus: r.reviewStatus,
    approvalStatus: r.approvalStatus,
    midApprovalStatus: r.midApprovalStatus, // [2026/06/18] - Lisa - Issue #11 供前端判斷各關卡退回顯示
    submittedAt: r.submittedAt.toISOString(),
  }))

  // ── SLA warnings ──────────────────────────────────────────────────────
  const slaWarnings = openCases
    .map(c => ({
      id: c.id,
      caseNumber: c.caseNumber,
      insuredName: c.insuredName,
      handlerName: c.assignments[0]?.employee.name ?? '—',
      commissionDate: c.commissionDate.toISOString(),
      currentStage: c.currentStage,
      slaStatus: getSlaStatus(c.commissionDate, c.preliminaryReportDate, '未決'),
    }))
    .filter(c => c.slaStatus !== 'normal')
    .sort((a, b) => (a.slaStatus === 'red' && b.slaStatus !== 'red' ? -1 : 1))
    .slice(0, 8)

  // ── Statute warnings (2-year expiry within 30 days) ───────────────────
  const statuteRows = statuteWarnings.map(c => {
    const expiryDate = dayjs(c.commissionDate).add(2, 'year')
    const daysLeft = expiryDate.diff(today, 'day')
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      insuredName: c.insuredName,
      handlerName: c.assignments[0]?.employee.name ?? '—',
      commissionDate: c.commissionDate.toISOString(),
      expiryDate: expiryDate.format('YYYY/MM/DD'),
      daysLeft,
    }
  })

  // ── Monthly trend (current year, 6 months) ────────────────────────────
  const months: { month: string; label: string }[] = []
  for (let i = 0; i < 6; i++) {
    const m = sixMonthsAgo.add(i, 'month')
    months.push({ month: m.format('YYYY-MM'), label: `${m.month() + 1}月` })
  }

  const monthlyData = months.map(({ month, label }) => {
    const newCount = newCasesByMonth.filter(r => dayjs(r.commissionDate).format('YYYY-MM') === month).reduce((s, r) => s + r._count.id, 0)
    const closedCount2 = closedByMonth.filter(r => r.closeDate && dayjs(r.closeDate).format('YYYY-MM') === month).reduce((s, r) => s + r._count.id, 0)
    return { month: label, 新受理: newCount, 已結案: closedCount2 }
  })

  return NextResponse.json({
    success: true,
    data: {
      kpi: { pendingCount, pendingLabel, openCount, yearlyFee, feeAchieveRate, countAchieveRate, caseScope, feeScope },
      pendingReviews,
      slaWarnings,
      statuteWarnings: statuteRows,
      monthlyData,
      stageDistribution: stageDistribution.map(s => ({ stage: s.currentStage, count: s._count.id })),
    },
  })
}
