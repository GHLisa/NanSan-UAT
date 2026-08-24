import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { splitFeeByRatio } from '@/lib/feeSplit'
import { getPrepaidTotals, getPrepayEventsInRange } from '@/lib/feeRecognition'
import { buildCaseScopeWhere, getCaseScopeLabel, getScopeEmployeeIds } from '@/lib/caseScope'
import { buildReviewWhere, defaultReviewTab } from '@/lib/reviewScope'
import type { Prisma } from '@prisma/client'
import dayjs from 'dayjs'
// [2026/08/05] - Lisa - SLA 燈號改用共用模組；「初報是否完成」為多來源判定（見 lib/reportStage）
// [2026/08/05] - Lisa - 「今天」一律取台北時間（伺服器為 UTC，台北 00:00~08:00 會落在前一日，
// 原本畫面用 dayjs()、排程信用 taipeiNow()，該時段兩者對同一案件的 D+N 會差一天）
import { getSlaStatus, taipeiNow } from '@/lib/sla'
import {
  finalApprovedReviewWhere, isPastPrelimStage, PRELIM_DOC_TYPES,
  // [2026/08/05] - Lisa - 待辦提醒：P1 初報期限、P2 待結案
  prelimPendingWhere, closingApprovedAt, FINAL_REPORT_DOC_TYPES, BILLING_DOC_TYPES,
  PRELIM_REMINDER_DAYS, CLOSING_REMINDER_DAYS,
  // [2026/08/05] - Lisa - SLA 分段：結報期限（節點6 核定後 60 天內未完成節點7）
  ADJUST_DOC_TYPES, CLOSING_REPORT_DEADLINE_DAYS, adjustApprovedAt, closingReportPendingWhere,
} from '@/lib/reportStage'
import { daysSinceCommission } from '@/lib/sla'

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
  // [2026/08/05] - Lisa - 改台北時間：年度統計與所有 D+N 判定（SLA、時效、待辦提醒）皆以台北曆日為準
  const today = taipeiNow()
  const currentYear = today.year()
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

  // ── [2026/08/05] - Lisa - 待辦提醒（P1 初報期限 / P2 待結案）──────────────
  // 對象＝實際跑案件的角色；執行副總只看審核待辦，不列單案節點時效以免洗版。
  const showReminders = ['handler', 'team_lead', 'dept_manager'].includes(session.role)
  // [2026/08/05] - Lisa - P1 視窗：委託日 D+0 ~ D+14（期限內）。逾期即離開待辦，
  // 改由 SLA 預警的「初報逾期」段接手，同一案件不同時出現在兩張卡片
  const prelimWindowStart = today.startOf('day').subtract(PRELIM_REMINDER_DAYS, 'day').toDate()

  // ── [效能] Wave 2：依賴 caseWhere / scopeEmpIds / reviewWhere 的查詢全部平行 ──
  const [
    openCount,
    openPrimaryCount,
    yearlySettlements,
    yearTargets,
    yearClosedCases,
    pendingReviewRows,
    openCases,
    statuteWarnings,
    newCasesByMonth,
    closedByMonth,
    stageDistribution,
    prelimApprovedRows,
    prelimReminderRows,
    closingCandidates,
    closingReportCandidates,
  ] = await Promise.all([
    // Open case count (scoped)
    prisma.case.count({ where: { ...caseWhere, status: '未決' } }),
    // [2026/08/04] - Lisa - 未決件數細分「主辦／協辦」- Start
    // 僅承辦人有意義（其他角色為部門/組別 scope 統計，無「自己主辦」概念 → null 不顯示）。
    // 以 AND 包住 caseWhere（不用 spread），避免覆蓋 handler scope 既有的 assignments 條件。
    // 協辦數由前端/下方以「總未決 − 主辦」求得，確保兩數相加恆等於卡片主數字。
    session.role === 'handler'
      ? prisma.case.count({
          where: {
            AND: [
              caseWhere,
              { status: '未決', assignments: { some: { employeeId: empId, role: '主辦' } } },
            ],
          },
        })
      : Promise.resolve(null),
    // [2026/08/04] - Lisa - 未決件數細分「主辦／協辦」- end
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
        parkingStatus: true, // [2026/08/05] - Lisa - 停泊案件（訴訟中/申訴中/待請求時效）另列一段
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
    // [2026/08/05] - Lisa - 已終審核准初報文件的案件（SLA 判定第二來源）；
    // 只取 caseId 供集合比對，避免把每案送審紀錄整批撈進儀表板
    prisma.caseReview.findMany({
      where: {
        ...finalApprovedReviewWhere(PRELIM_DOC_TYPES),
        case: { is: { ...caseWhere, status: '未決' } },
      },
      select: { caseId: true },
      distinct: ['caseId'],
    }),
    // [2026/08/05] - Lisa - P1 初報期限：委託後 14 天內（＋逾期 5 天緩衝）且初報尚未完成（多來源判定）
    showReminders
      ? prisma.case.findMany({
          where: {
            ...caseWhere,
            status: '未決',
            ...prelimPendingWhere(),
            commissionDate: { gte: prelimWindowStart },
          },
          select: {
            id: true, caseNumber: true, insuredName: true, commissionDate: true, currentStage: true,
            assignments: { where: { role: '主辦' }, include: { employee: { select: { name: true } } }, take: 1 },
          },
          orderBy: { commissionDate: 'asc' }, // 委託日最早＝剩餘天數最少，排最前
        })
      : Promise.resolve([]),
    // [2026/08/05] - Lisa - P2 待結案：先以「已終審核准的結案報告書」縮小候選，
    // 節點8（請款單／合併送審）與起算日於程式端判定（合併送審單筆即同時滿足兩節點）
    showReminders
      ? prisma.case.findMany({
          where: {
            ...caseWhere,
            status: '未決',
            reviews: { some: finalApprovedReviewWhere(FINAL_REPORT_DOC_TYPES) },
          },
          select: {
            id: true, caseNumber: true, insuredName: true, currentStage: true,
            assignments: { where: { role: '主辦' }, include: { employee: { select: { name: true } } }, take: 1 },
            reviews: {
              where: { documentType: { in: [...FINAL_REPORT_DOC_TYPES, ...BILLING_DOC_TYPES] } },
              select: {
                documentType: true, mergedBilling: true, recordStatus: true,
                reviewStatus: true, midApprovalStatus: true, approvalStatus: true,
                requiresVP: true, requiresMidApproval: true,
                reviewedAt: true, midApprovedAt: true, approvedAt: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    // [2026/08/05] - Lisa - SLA「結報期限」段候選：節點6（理算書面報告書）已終審核准、
    // 節點7（結案報告書）尚未終審核准；起算日於程式端取最新一次核定時間
    prisma.case.findMany({
      where: { ...caseWhere, status: '未決', ...closingReportPendingWhere() },
      select: {
        id: true,
        reviews: {
          where: { documentType: { in: ADJUST_DOC_TYPES } },
          select: {
            documentType: true, recordStatus: true,
            reviewStatus: true, midApprovalStatus: true, approvalStatus: true,
            requiresVP: true, requiresMidApproval: true,
            reviewedAt: true, midApprovedAt: true, approvedAt: true,
          },
        },
      },
    }),
  ])

  // ── 未決件數：主辦／協辦拆分（承辦人專屬；其他角色 null）────────────────
  // [2026/08/04] - Lisa - 協辦＝總未決 − 自己主辦，避免同案重複指派時兩數相加超過總數
  const openCountPrimary = openPrimaryCount
  const openCountAssist =
    openPrimaryCount == null ? null : Math.max(openCount - openPrimaryCount, 0)

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
  // [2026/08/04] - Lisa - FR-110 結案件數改「只計 scope 內人員擔任主辦」的案件（原為只要有人參與即計 1），
  // 與純公證費業績設定實績件數、已決案明細表季統計（FR-109）同一口徑；金額仍為份額加總不變。
  // [2026/08/21] - Lisa - 公證費預付請款依出具日期認列：結案月改用 actualFee 扣除該案累計已認列的
  // 預付金額（避免與出具當月重複計入，可能為負），並把預付事件依出具日期併入年度實際值（不影響結案件數）。
  const prepaidTotals = await getPrepaidTotals(yearClosedCases.map((c) => c.id))
  let actualFeePure = 0
  let actualClosedCount = 0
  for (const c of yearClosedCases) {
    const inScope = c.assignments.some(a => scopeEmpIdSet.has(a.employeeId))
    if (!inScope) continue
    if (c.assignments.some(a => a.role === '主辦' && scopeEmpIdSet.has(a.employeeId))) actualClosedCount += 1
    const netFee = (c.actualFee ?? 0) - (prepaidTotals.get(c.id) ?? 0)
    if (netFee) {
      // 依承辦比例分攤（非主辦捨去、主辦吸收剩餘），僅加總 scope 內承辦人份額
      const amts = splitFeeByRatio(netFee, c.assignments, a => a.contributionRatio ?? 1, a => a.role === '主辦')
      actualFeePure += c.assignments.reduce(
        (s, a, i) => (scopeEmpIdSet.has(a.employeeId) ? s + amts[i] : s),
        0,
      )
    }
  }

  const yearPrepayEvents = await getPrepayEventsInRange(caseWhere, { gte: yearStart, lte: new Date(yearEnd.getTime() - 1) })
  for (const e of yearPrepayEvents) {
    const inScope = e.assignments.some(a => scopeEmpIdSet.has(a.employeeId))
    if (!inScope) continue
    const amts = splitFeeByRatio(e.amount, e.assignments, a => a.contributionRatio ?? 1, a => a.role === '主辦')
    actualFeePure += e.assignments.reduce(
      (s, a, i) => (scopeEmpIdSet.has(a.employeeId) ? s + amts[i] : s),
      0,
    )
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

  // ── SLA warnings（分段）────────────────────────────────────────────────
  // [2026/08/05] - Lisa - 依客戶需求改為四段，並採「每案只歸一段」的優先序：
  //   ⏸ 停泊（合法暫停，不計逾期，優先於一切）
  //   ⏱ 初報逾期（未完成節點2 且 D+14 以上；D+0~14 由待辦事項負責）
  //   📐 結報期限（節點6 核定後 60 天內未完成節點7；期限前即倒數）
  //   🕰 長期未決（D+90 以上）
  // 不做優先序的話，結報期限那批會被長期未決整批吃掉（實測 9 成同時符合 D+90）。
  const prelimApprovedIds = new Set(prelimApprovedRows.map(r => r.caseId))
  const closingReportStartAt = new Map<number, Date>()
  for (const c of closingReportCandidates) {
    const at = adjustApprovedAt(c.reviews)
    if (at) closingReportStartAt.set(c.id, at)
  }

  type SlaItem = {
    id: number; caseNumber: string; insuredName: string; handlerName: string
    commissionDate: string; currentStage: string; daysSince: number
    slaStatus?: 'red' | 'yellow'
    approvedAt?: string; daysLeft?: number
    parkingStatus?: string
  }
  const slaPrelim: SlaItem[] = []
  const slaClosingReport: SlaItem[] = []
  const slaLongOpen: SlaItem[] = []
  const slaParked: SlaItem[] = []

  for (const c of openCases) {
    const daysSince = daysSinceCommission(c.commissionDate, today)
    const base: SlaItem = {
      id: c.id,
      caseNumber: c.caseNumber,
      insuredName: c.insuredName,
      handlerName: c.assignments[0]?.employee.name ?? '—',
      commissionDate: c.commissionDate.toISOString(),
      currentStage: c.currentStage,
      daysSince,
    }
    // 停泊案件＝合法暫停中，不計逾期，一律另段呈現
    if (c.parkingStatus) {
      slaParked.push({ ...base, parkingStatus: c.parkingStatus })
      continue
    }
    const prelimDone =
      !!c.preliminaryReportDate || isPastPrelimStage(c.currentStage) || prelimApprovedIds.has(c.id)
    if (!prelimDone && daysSince >= PRELIM_REMINDER_DAYS) {
      slaPrelim.push({ ...base, slaStatus: getSlaStatus(c.commissionDate, false, '未決', today) as 'red' | 'yellow' })
      continue
    }
    const startAt = closingReportStartAt.get(c.id)
    if (startAt) {
      slaClosingReport.push({
        ...base,
        approvedAt: startAt.toISOString(),
        daysLeft: CLOSING_REPORT_DEADLINE_DAYS - daysSinceCommission(startAt, today),
      })
      continue
    }
    if (daysSince >= 90) slaLongOpen.push({ ...base, slaStatus: 'red' })
  }

  const SLA_PREVIEW = 3
  slaPrelim.sort((a, b) => b.daysSince - a.daysSince)             // 逾期最久者最前
  slaClosingReport.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0)) // 逾期／最快到期者最前
  slaLongOpen.sort((a, b) => b.daysSince - a.daysSince)
  slaParked.sort((a, b) => b.daysSince - a.daysSince)
  const slaSections = {
    prelim: { total: slaPrelim.length, items: slaPrelim.slice(0, SLA_PREVIEW) },
    closingReport: { total: slaClosingReport.length, items: slaClosingReport.slice(0, SLA_PREVIEW) },
    longOpen: { total: slaLongOpen.length, items: slaLongOpen.slice(0, SLA_PREVIEW) },
    parked: { total: slaParked.length, items: slaParked.slice(0, SLA_PREVIEW) },
  }

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

  // ── [2026/08/05] - Lisa - 待辦提醒 P1／P2 ────────────────────────────────
  // 卡片只顯示前 3 筆，故一併回傳 total 供「還有 N 件」與「查看全部」
  const REMINDER_PREVIEW = 3

  const prelimItems = prelimReminderRows.map(c => ({
    id: c.id,
    caseNumber: c.caseNumber,
    insuredName: c.insuredName,
    handlerName: c.assignments[0]?.employee.name ?? '—',
    commissionDate: c.commissionDate.toISOString(),
    currentStage: c.currentStage,
    // 剩餘天數：0 = 今天到期；負值 = 逾期（緩衝 5 天內仍列於待辦，之後由 SLA 預警接手）
    daysLeft: PRELIM_REMINDER_DAYS - daysSinceCommission(c.commissionDate, today),
  }))
  // 逾期者（daysLeft 為負）排最前，其次剩餘天數少者；查詢已依委託日 asc，此處明示排序意圖
  prelimItems.sort((a, b) => a.daysLeft - b.daysLeft)

  const closeItems = closingCandidates
    .map(c => {
      const startAt = closingApprovedAt(c.reviews)
      if (!startAt) return null // 節點8（請款單／合併送審）尚未核准 → 還不到催結案的時候
      return {
        id: c.id,
        caseNumber: c.caseNumber,
        insuredName: c.insuredName,
        handlerName: c.assignments[0]?.employee.name ?? '—',
        approvedAt: startAt.toISOString(),
        currentStage: c.currentStage,
        // 負值＝已逾期；本段保留逾期案件（結案無其他預警卡片接手）
        daysLeft: CLOSING_REMINDER_DAYS - daysSinceCommission(startAt, today),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.daysLeft - b.daysLeft) // 逾期最久者最前

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
      kpi: {
        pendingCount, pendingLabel, openCount,
        openCountPrimary, openCountAssist, // [2026/08/04] - Lisa - 未決件數主辦/協辦拆分
        yearlyFee, feeAchieveRate, countAchieveRate, caseScope, feeScope,
      },
      pendingReviews,
      // [2026/08/05] - Lisa - 待辦事項卡片第2/3段：P1 初報期限、P2 待結案
      reminders: {
        prelim: { total: prelimItems.length, items: prelimItems.slice(0, REMINDER_PREVIEW) },
        close: { total: closeItems.length, items: closeItems.slice(0, REMINDER_PREVIEW) },
      },
      // [2026/08/05] - Lisa - SLA 預警改四段（停泊／初報逾期／結報期限／長期未決）
      slaSections,
      statuteWarnings: statuteRows,
      monthlyData,
      stageDistribution: stageDistribution.map(s => ({ stage: s.currentStage, count: s._count.id })),
    },
  })
}
