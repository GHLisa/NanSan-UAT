import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { mailNewAssignment } from '@/lib/caseMail'
import { newAssignmentNotification } from '@/lib/caseNotify'
import { parseBody } from '@/lib/apiError'
// [2026/08/04] - Lisa - FR-108 同群組流水號重複判定（與編號修正共用同一份規則）
import { findSeqConflicts, parseSeqParts } from '@/lib/caseNumber'
// [2026/08/05] - Lisa - 初報完成判定（多來源）與 SLA 燈號共用模組
import {
  isPrelimDone, prelimPendingWhere, finalApprovedReviewWhere, closingApprovedAt,
  closingReportPendingWhere, FINAL_REPORT_DOC_TYPES, BILLING_DOC_TYPES, PRELIM_REMINDER_DAYS,
} from '@/lib/reportStage'
// [2026/08/05] - Lisa - 「今天」改取台北時間，與排程彙整信（lib/digestMail）同一基準；
// 伺服器為 UTC，台北 00:00~08:00 用 dayjs() 會算成前一日，造成同一案件燈號差一天
import { getSlaStatus, taipeiNow, daysSinceCommission } from '@/lib/sla'
// [2026/08/27] - Lisa - 案件管理清單欄位／區間搜尋改用「預估賠償額」（＝預估金額－自負額），與副總門檻同一算法
import { getClaimAmount } from '@/lib/approvalFlow'

// [2026/07/27] - Lisa - 公證編號排序鍵：取「年度(前2碼)＋後三碼」，公證前綴與區域碼不列入排序
// 例：NFNS-26K-024 → { year: 26, serial: 24 }；無法解析者以 -1 排在最後
function caseNoSortKey(caseNumber: string): { year: number; serial: number } {
  const parts = (caseNumber ?? '').split('-')
  const mid = parts[1] ?? ''
  const last = parts[parts.length - 1] ?? ''
  const year = parseInt(mid.slice(0, 2), 10)
  const serial = parseInt(last.replace(/\D/g, '').slice(-3), 10)
  return { year: Number.isNaN(year) ? -1 : year, serial: Number.isNaN(serial) ? -1 : serial }
}

async function buildCaseScope(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return {}
  if (canViewAllDepts(session.role) || !session.departmentId) return {}

  // FR-34/FR-04：組長僅可視「同部門＋同組別承辦人」的案件
  if (session.role === 'team_lead' && session.teamGroup) {
    const roles = await prisma.employeeRole.findMany({
      where: { departmentId: session.departmentId, teamGroup: session.teamGroup },
      select: { employeeId: true },
    })
    const employeeIds = Array.from(new Set(roles.map((r) => r.employeeId)))
    return {
      departmentId: session.departmentId,
      assignments: { some: { employeeId: { in: employeeIds } } },
    }
  }

  // 組長無組別 / 部門主管 / 行政人員：本部門範圍
  return { departmentId: session.departmentId }
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl

  // 案件查詢第二層連動：某保險公司在可視範圍內既有案件的 distinct 承辦人（去空白後去重）
  if (searchParams.get('mode') === 'contacts') {
    const icIdParam = searchParams.get('insuranceCompanyId')
    if (!icIdParam) return NextResponse.json({ success: true, data: [] })
    const scope = await buildCaseScope(session)
    const rows = await prisma.case.findMany({
      where: {
        ...scope,
        insuranceCompanyId: parseInt(icIdParam),
        insuranceContact: { not: null },
        ...(session.role === 'handler' ? { assignments: { some: { employeeId: parseInt(session.sub) } } } : {}),
      },
      select: { insuranceContact: true },
      distinct: ['insuranceContact'],
    })
    // 回傳「原始 distinct 值」而非 trim 後的值，確保選項與後續 IN 篩選完全對得起來；僅濾掉空白項
    const contacts = rows
      .map((r) => r.insuranceContact)
      .filter((c): c is string => !!c && c.trim() !== '')
      .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    return NextResponse.json({ success: true, data: contacts })
  }

  const page = parseInt(searchParams.get('page') ?? '1')
  const pageSize = parseInt(searchParams.get('pageSize') ?? '15')
  const status = searchParams.get('status') ?? '未決'   // 預設只顯示未決；'all' = 不篩選
  const keyword = searchParams.get('q')
  const deptId = searchParams.get('deptId')
  const stage = searchParams.get('stage')
  const assigneeId = searchParams.get('assigneeId')
  const incidentDateFrom = searchParams.get('incidentDateFrom')
  const incidentDateTo = searchParams.get('incidentDateTo')
  // [2026/08/26] - Lisa - 預估賠償額區間搜尋，前端輸入單位為「萬元」，換算後與預估賠償額（元）比較
  // [2026/08/27] - Lisa - 由「預估金額」改為「預估賠償額」（＝預估金額－自負額），欄位/參數同步更名
  const estimatedClaimAmountMin = searchParams.get('estimatedClaimAmountMin')
  const estimatedClaimAmountMax = searchParams.get('estimatedClaimAmountMax')
  const filterYear = searchParams.get('year')       // 依結案日年份
  const filterQuarter = searchParams.get('quarter') // Q1~Q4
  const icId = searchParams.get('insuranceCompanyId')  // 保險公司（第一層篩選）
  const contactsParam = searchParams.get('contacts')   // 保險公司承辦人（第二層，逗號分隔多選）
  // [2026/08/04] - Lisa - 儀表板「SLA 預警／兩年時效預警／待辦事項 → 查看全部」帶入的預警篩選
  // （sla | statute | returned）；判定規則與 /api/dashboard 相同，確保清單即為該卡片的完整清單
  const alert = searchParams.get('alert')

  const scopeFilter = await buildCaseScope(session)

  const where: Record<string, unknown> = { ...scopeFilter }
  if (status && status !== 'all') where.status = status
  if (deptId) where.departmentId = parseInt(deptId)
  if (icId) where.insuranceCompanyId = parseInt(icId)
  if (contactsParam) {
    const list = contactsParam.split(',').map((s) => s.trim()).filter(Boolean)
    if (list.length) where.insuranceContact = { in: list }
  }
  if (stage) where.currentStage = stage
  if (session.role === 'handler') {
    // 承辦人只能查詢自己為主辦或協辦的案件
    where.assignments = { some: { employeeId: parseInt(session.sub) } }
    // [2026/06/18] - Lisa - Issue #5 承辦人案件清單一律不限部門，與導覽 badge myCaseCount 一致 - Start
    // 承辦人無部門篩選 UI，且可能於他部門協辦；一律移除 buildCaseScope 與 deptId 參數帶入的部門條件，
    // 避免跨部門協辦案件被濾掉（清單件數應等於 badge）
    delete where.departmentId
    // [2026/06/18] - Lisa - Issue #5 承辦人案件清單一律不限部門 - end
  } else if (assigneeId) {
    where.assignments = { some: { employeeId: parseInt(assigneeId) } }
  }
  if (incidentDateFrom || incidentDateTo) {
    where.incidentDate = {
      ...(incidentDateFrom ? { gte: new Date(incidentDateFrom) } : {}),
      ...(incidentDateTo ? { lte: new Date(incidentDateTo) } : {}),
    }
  }
  // [2026/08/27] - Lisa - 預估賠償額（＝預估金額－自負額）為計算欄位，Prisma 無法直接下 where 篩選，
  // 改於下方 allMatched 取回 estimatedAmount/deductible 後於程式端計算、過濾（只填前格 >=、只填後格 <=、兩格皆填 between；萬元換算為元）

  // 年份/季度篩選（依委託日）
  // [2026/07/14] - Lisa - 年度改依委託日 commissionDate（原為結案日 closeDate）；
  // 因結案日僅已決案件有值，改用委託日後預設當年度仍能涵蓋未決/銷案案件
  if (filterYear) {
    const year = parseInt(filterYear)
    const qMonth: Record<string, [number, number]> = {
      Q1: [1, 3], Q2: [4, 6], Q3: [7, 9], Q4: [10, 12],
    }
    const [m1, m2] = filterQuarter ? qMonth[filterQuarter] ?? [1, 12] : [1, 12]
    where.commissionDate = {
      gte: new Date(`${year}-${String(m1).padStart(2, '0')}-01`),
      lte: new Date(`${year}-${String(m2).padStart(2, '0')}-${m2 === 3 || m2 === 6 || m2 === 9 ? 30 : m2 === 12 ? 31 : 30}`),
    }
  }

  if (keyword) {
    where.OR = [
      { caseNumber: { contains: keyword, mode: 'insensitive' } },
      { insuredName: { contains: keyword, mode: 'insensitive' } },
      { policyNumber: { contains: keyword, mode: 'insensitive' } },
      { insuranceCompany: { name: { contains: keyword, mode: 'insensitive' } } },
      // [2026/07/28] - Lisa - 關鍵字搜尋新增保代/保經公司名稱（無保代之案件不會被納入）
      { brokerCompany: { name: { contains: keyword, mode: 'insensitive' } } },
    ]
  }

  // [2026/08/04] - Lisa - 預警篩選（僅未決案件）；以 AND 疊加而非直接指定欄位條件，
  // 因 where.OR 已被關鍵字搜尋佔用、where.commissionDate 可能已被年度/季度篩選佔用
  if (alert === 'sla' || alert === 'statute') {
    where.status = '未決'
    // 以台北曆日為界（startOf('day')），使門檻與清單列的 D+N 判定完全一致
    const now = taipeiNow().startOf('day')
    where.AND = [
      alert === 'sla'
        // SLA 預警：未完成初步報告且委託滿 14 天（黃/紅燈），或委託已滿 90 天（紅燈）
        // [2026/08/05] - Lisa - 「未完成初報」改用 prelimPendingWhere()（日期／終審核准／案件階段三來源）
        // 「滿 N 天」＝委託日在「今天減 (N−1) 天」的台北零點之前（用 lt 而非 lte）：
        // DB 內 commissionDate 有台北午夜(16:00Z)與 UTC 午夜(00:00Z) 兩種存法，用 lte 會漏掉後者。
        ? {
            OR: [
              { ...prelimPendingWhere(), commissionDate: { lt: now.subtract(13, 'day').toDate() } },
              { commissionDate: { lt: now.subtract(89, 'day').toDate() } },
            ],
          }
        // 兩年時效預警：請求權到期日（委託日 +2 年）在 30 天內到期或已逾期
        : { commissionDate: { lte: now.subtract(2, 'year').add(30, 'day').toDate() } },
    ]
  }

  // [2026/08/04] - Lisa - 退回待修：案件有「未終結(recordStatus=null)且任一關卡退回」的送審紀錄。
  // 此處先以 some 縮小候選，稍後再比照清單「退件」標記（每個文件類型只看最新一次送審）精確過濾，
  // 避免篩出的列沒有退件標記。注意 withSummary 聚合走此 where（為候選集合），
  // 案件查詢頁不會帶 alert，故不影響其統計卡數字。
  const returnedOnly = alert === 'returned'
  if (returnedOnly) {
    where.reviews = {
      some: {
        recordStatus: null,
        OR: [{ reviewStatus: '退回' }, { midApprovalStatus: '退回' }, { approvalStatus: '退回' }],
      },
    }
  }

  // [2026/08/05] - Lisa - 待辦提醒兩段的完整清單（與 /api/dashboard 同判定）
  // prelim14：委託後 14 天內（期限內）且初報未完成；逾期者屬 SLA 預警的「初報逾期」段
  if (alert === 'prelim14') {
    where.status = '未決'
    where.AND = [
      prelimPendingWhere(),
      { commissionDate: { gte: taipeiNow().startOf('day').subtract(PRELIM_REMINDER_DAYS, 'day').toDate() } },
    ]
  }

  // [2026/08/05] - Lisa - SLA 預警四段的完整清單；與儀表板同樣採「每案只歸一段」的優先序
  // （停泊 > 初報逾期 > 結報期限 > 長期未決），故後段需排除前段條件，件數才對得起來
  if (alert === 'prelim_overdue' || alert === 'closing60' || alert === 'open90' || alert === 'parked') {
    const day0 = taipeiNow().startOf('day')
    // 「滿 N 天」的台北日界：委託日 < 今天減 (N−1) 天的零點（lt 而非 lte，說明見上方 sla 分支）
    const d14 = day0.subtract(PRELIM_REMINDER_DAYS - 1, 'day').toDate()
    const d90 = day0.subtract(89, 'day').toDate()
    // 初報逾期（未完成節點2 且 D+14 以上）
    const prelimOverdue = { AND: [prelimPendingWhere(), { commissionDate: { lt: d14 } }] }
    where.status = '未決'
    if (alert === 'parked') {
      where.parkingStatus = { not: null }
    } else {
      where.parkingStatus = null // 停泊案件另段呈現，不計逾期
      if (alert === 'prelim_overdue') {
        where.AND = [prelimPendingWhere(), { commissionDate: { lt: d14 } }]
      } else if (alert === 'closing60') {
        where.AND = [closingReportPendingWhere()]
        where.NOT = [prelimOverdue]
      } else {
        where.AND = [{ commissionDate: { lt: d90 } }]
        where.NOT = [prelimOverdue, closingReportPendingWhere()]
      }
    }
  }
  // close14：節點7 結案報告書已終審核准者為候選，節點8（請款單／合併送審）與起算日於程式端精算
  const closingOnly = alert === 'close14'
  if (closingOnly) {
    where.status = '未決'
    where.reviews = { some: finalApprovedReviewWhere(FINAL_REPORT_DOC_TYPES) }
  }

  // [2026/08/25] - Lisa - 未落實流程送審：「案件紀錄」提到「初步報告」，但流程階段仍卡在進件/建檔
  // （與儀表板「案件紀錄填寫 & 未落實流程送審 提醒」同一判定；即案件管理清單紅字標記的規則）
  if (alert === 'prelimNoteStuck') {
    where.status = '未決'
    where.currentStage = '進件/建檔'
    where.caseNotes = { some: { content: { contains: '初步報告' } } }
  }

  // [2026/08/25] - Lisa - 案件紀錄填寫：初報已逾期（D+14 以上，與 SLA 初報逾期段同一判定）
  // 且完全未填任何「案件紀錄」
  if (alert === 'noteMissing') {
    where.status = '未決'
    const d14 = taipeiNow().startOf('day').subtract(PRELIM_REMINDER_DAYS - 1, 'day').toDate()
    where.AND = [prelimPendingWhere(), { commissionDate: { lt: d14 } }]
    where.caseNotes = { none: {} }
  }

  // [2026/07/14] - Lisa - 案件查詢統計卡需「全量」件數與費用合計，不受分頁上限影響；
  // withSummary=1 時另跑一次聚合，回傳整個篩選範圍的 公證費/差旅其他費 總額（件數沿用 total）
  const wantSummary = searchParams.get('withSummary') === '1'

  // [2026/07/27] - Lisa - 排序改依公證編號「年度+後三碼」由大到小；因需跨全體排序後再分頁，
  // 先輕量取回符合條件的 id/caseNumber 做全域排序，再只針對「當頁」id 撈完整資料（含關聯）
  // [2026/08/27] - Lisa - 一併取回 estimatedAmount/deductible，供下方計算「預估賠償額」區間篩選
  const allMatched = await prisma.case.findMany({
    where,
    select: { id: true, caseNumber: true, estimatedAmount: true, deductible: true },
  })
  let matched = allMatched
  // [2026/08/27] - Lisa - 預估賠償額（＝預估金額－自負額）區間篩選：計算欄位無法下 Prisma where，
  // 於程式端以 getClaimAmount 計算後過濾（只填前格 >=、只填後格 <=、兩格皆填 between；萬元換算為元）
  if (estimatedClaimAmountMin || estimatedClaimAmountMax) {
    const minV = estimatedClaimAmountMin ? Math.round(parseFloat(estimatedClaimAmountMin) * 10000) : null
    const maxV = estimatedClaimAmountMax ? Math.round(parseFloat(estimatedClaimAmountMax) * 10000) : null
    matched = matched.filter((c) => {
      const claim = getClaimAmount(
        c.estimatedAmount != null ? Number(c.estimatedAmount) : null,
        c.deductible != null ? Number(c.deductible) : null,
      )
      if (minV != null && claim < minV) return false
      if (maxV != null && claim > maxV) return false
      return true
    })
  }
  // [2026/08/04] - Lisa - 退回待修精確過濾：每個 documentType 只看最新一次送審，且該筆未終結並為退回，
  // 與下方列資料的 hasRejectedReview（橘色「退件」標記）同一判定，確保件數與標記一致
  if (returnedOnly && matched.length > 0) {
    const reviewRows = await prisma.caseReview.findMany({
      where: { caseId: { in: matched.map((c) => c.id) } },
      select: {
        caseId: true, documentType: true, submittedAt: true, recordStatus: true,
        reviewStatus: true, midApprovalStatus: true, approvalStatus: true,
      },
    })
    const latestByDoc = new Map<string, typeof reviewRows[number]>()
    for (const r of reviewRows) {
      const key = `${r.caseId}|${r.documentType}`
      const cur = latestByDoc.get(key)
      if (!cur || r.submittedAt > cur.submittedAt) latestByDoc.set(key, r)
    }
    const keep = new Set<number>()
    for (const r of latestByDoc.values()) {
      if (r.recordStatus != null) continue
      if (r.reviewStatus === '退回' || r.midApprovalStatus === '退回' || r.approvalStatus === '退回') {
        keep.add(r.caseId)
      }
    }
    matched = matched.filter((c) => keep.has(c.id))
  }
  // [2026/08/05] - Lisa - 待結案精確過濾：候選已確定節點7 核准，此處再確認節點8（請款單／合併送審）
  // 亦已終審核准，與儀表板「待結案」提醒同一判定（closingApprovedAt）
  if (closingOnly && matched.length > 0) {
    const reviewRows = await prisma.caseReview.findMany({
      where: {
        caseId: { in: matched.map((c) => c.id) },
        documentType: { in: [...FINAL_REPORT_DOC_TYPES, ...BILLING_DOC_TYPES] },
      },
      select: {
        caseId: true, documentType: true, mergedBilling: true, recordStatus: true,
        reviewStatus: true, midApprovalStatus: true, approvalStatus: true,
        requiresVP: true, requiresMidApproval: true,
        reviewedAt: true, midApprovedAt: true, approvedAt: true,
      },
    })
    const byCase = new Map<number, typeof reviewRows>()
    for (const r of reviewRows) {
      const list = byCase.get(r.caseId) ?? []
      list.push(r)
      byCase.set(r.caseId, list)
    }
    matched = matched.filter((c) => closingApprovedAt(byCase.get(c.id) ?? []) != null)
  }
  matched.sort((a, b) => {
    const ka = caseNoSortKey(a.caseNumber)
    const kb = caseNoSortKey(b.caseNumber)
    return kb.year - ka.year || kb.serial - ka.serial
  })
  const total = matched.length
  const pageIds = matched.slice((page - 1) * pageSize, page * pageSize).map((c) => c.id)
  // [2026/08/27] - Lisa - 統計卡聚合改以「最終篩選後」的 id 清單為範圍（原本沿用 where 聚合，
  // 未含預估賠償額此類程式端計算篩選，會與畫面清單件數對不起來）
  const [pageCases, summaryAgg] = await Promise.all([
    prisma.case.findMany({
      where: { id: { in: pageIds } },
      include: {
        department: { select: { name: true } },
        insuranceCompany: { select: { name: true } },
        brokerCompany: { select: { name: true } },
        assignments: { select: { employeeId: true, role: true, employee: { select: { name: true } } } },
        // [2026/06/18] - Lisa - Issue #9/#10 退件涵蓋全關卡 + 只看每個文件類型最新一次送審 - Start
        // 撈該案全部送審（含已核准），以便依 submittedAt 取每個 documentType 的最新一筆判定狀態
        reviews: {
          select: {
            reviewStatus: true, reviewRemarks: true,
            midApprovalStatus: true, midApprovalRemarks: true,
            approvalStatus: true, approvalRemarks: true,
            documentType: true, submittedAt: true,
            recordStatus: true, // [2026/06/18] - Lisa - 方案1/2 終結狀態（已重送/已放棄）
            mergedBilling: true, // [2026/07/15] - Lisa - 合併送審旗標（清單 (併DN) 標註用）
            // [2026/08/05] - Lisa - 判定「終審核准」需知該筆是否有加簽／副總關卡（初報完成判定用）
            requiresVP: true, requiresMidApproval: true,
          },
        },
        // [2026/06/18] - Lisa - Issue #9/#10 - end
        // [2026/08/25] - Lisa - 「初步報告」字樣曾出現於備註/進度/異動紀錄，但流程階段仍卡在進件：
        // 疑似未落實送審流程，清單需標紅提醒（僅取 1 筆即可判斷是否存在，不需完整內容）
        caseNotes: { where: { content: { contains: '初步報告' } }, select: { id: true }, take: 1 },
      },
    }),
    wantSummary
      ? prisma.case.aggregate({
          where: { id: { in: matched.map((c) => c.id) } },
          _sum: { actualFee: true, travelOtherExpense: true },
        })
      : Promise.resolve(null),
  ])
  // in 查詢不保證順序，依全域排序結果還原「當頁」順序
  const caseById = new Map(pageCases.map((c) => [c.id, c]))
  const cases = pageIds.map((id) => caseById.get(id)).filter((c): c is typeof pageCases[number] => !!c)

  const today = taipeiNow()
  const data = cases.map((c) => {
    // [2026/08/05] - Lisa - D+N 改用共用的台北曆日算法，與 SLA 燈號、排程信、儀表板完全一致
    const daysSince = daysSinceCommission(c.commissionDate, today)
    // [2026/08/05] - Lisa - 初報完成改多來源判定（日期／初報文件終審核准／階段已越過初報），
    // 燈號門檻沿用共用模組 lib/sla；'normal' 對應清單的綠燈
    const prelimDone = isPrelimDone(c)
    const sla = getSlaStatus(c.commissionDate, prelimDone, c.status, today)
    const slaStatus: 'green' | 'yellow' | 'red' = sla === 'normal' ? 'green' : sla
    const primaryHandler = c.assignments.find(a => a.role === '主辦') ?? c.assignments[0]
    // [2026/06/18] - Lisa - Issue #9/#10 退件涵蓋全關卡 + 只看每個文件類型「最新一次送審」- Start
    // 每個 documentType 取最新一筆送審（依 submittedAt），避免「曾被退回過就永遠顯示退件」
    const latestByDoc = new Map<string, typeof c.reviews[number]>()
    for (const r of c.reviews) {
      const cur = latestByDoc.get(r.documentType)
      if (!cur || r.submittedAt > cur.submittedAt) latestByDoc.set(r.documentType, r)
    }
    const latestReviews = [...latestByDoc.values()]
    const rejectedReviews = latestReviews
      .map(r => {
        // [2026/06/18] - Lisa - 方案1/2 已重送/已放棄（終結）不計入退件
        if (r.recordStatus != null) return null
        if (r.reviewStatus === '退回') return { documentType: r.documentType, gate: '主管複核', remark: r.reviewRemarks }
        if (r.midApprovalStatus === '退回') return { documentType: r.documentType, gate: '加簽審核', remark: r.midApprovalRemarks }
        if (r.approvalStatus === '退回') return { documentType: r.documentType, gate: '執行副總', remark: r.approvalRemarks }
        return null
      })
      .filter((x): x is { documentType: string; gate: string; remark: string | null } => x !== null)
    const hasPending = latestReviews.some(r => r.reviewStatus === '待複核' || r.approvalStatus === '待執行副總閱')
    // [2026/06/18] - Lisa - Issue #9/#10 - end
    // [2026/07/15] - Lisa - 合併送審：本案是否有 active 的「結案報告書 && mergedBilling」review（清單 (併DN) 標註）
    const hasMergedBilling = c.reviews.some(r => r.documentType === '結案報告書' && r.mergedBilling && r.recordStatus === null)
    // [2026/08/25] - Lisa - 備註曾提到「初步報告」（已擬/已出具/寄出等），但流程階段從未離開「進件/建檔」，
    // 疑似只在備註手動記事、忘了同步推進階段 → 清單整列標紅提醒
    const prelimNoteStuckAtIntake = c.currentStage === '進件/建檔' && c.caseNotes.length > 0

    return {
      id: c.id,
      caseNumber: c.caseNumber,
      departmentId: c.departmentId,
      departmentName: c.department.name,
      insuranceCompanyId: c.insuranceCompanyId,
      insuranceCompanyName: c.insuranceCompany.name,
      insuranceContact: c.insuranceContact,
      brokerCompanyName: c.brokerCompany?.name ?? null,
      policyNumber: c.policyNumber,
      insuredName: c.insuredName,
      insuranceType: c.insuranceType,
      incidentLocation: c.incidentLocation,
      incidentDate: c.incidentDate.toISOString(),
      commissionDate: c.commissionDate.toISOString(),
      status: c.status,
      currentStage: c.currentStage,
      parkingStatus: c.parkingStatus,
      estimatedAmount: c.estimatedAmount,
      // [2026/08/27] - Lisa - 預估賠償額（＝預估金額－自負額，負值以 0 計）：案件管理清單改顯示此欄位；
      // 無預估金額者維持顯示「—」，與案件詳情頁金額資訊卡同一算法
      estimatedClaimAmount: c.estimatedAmount != null
        ? getClaimAmount(Number(c.estimatedAmount), c.deductible != null ? Number(c.deductible) : null)
        : null,
      estimatedFee: c.estimatedFee,
      actualFee: c.actualFee,
      finalAmount: c.finalAmount,
      closeDate: c.closeDate?.toISOString() ?? null,
      preliminaryReportDate: c.preliminaryReportDate?.toISOString() ?? null,
      daysSince,
      slaStatus,
      prelimDone, // [2026/08/05] - Lisa - 供前端於燈號 tooltip 說明初報是否已完成
      primaryHandlerName: primaryHandler?.employee.name ?? '—',
      travelOtherExpenseTotal: c.travelOtherExpense ?? 0,
      handlers: c.assignments.map((a) => ({ id: a.employeeId, name: a.employee.name, role: a.role })),
      hasRejectedReview: rejectedReviews.length > 0,
      // [2026/06/18] - Lisa - Issue #9 帶出關卡別 gate 與該關卡退回意見 remark
      rejectedReviews: rejectedReviews.map(r => ({ documentType: r.documentType, gate: r.gate, reviewRemarks: r.remark })),
      hasPendingReview: hasPending,
      hasMergedBilling, // [2026/07/15] - Lisa - 合併送審 (併DN) 標註
      prelimNoteStuckAtIntake, // [2026/08/25] - Lisa - 備註提及初步報告但階段仍卡在進件（疑似未落實送審流程）
    }
  })

  const summary = summaryAgg
    ? {
        count: total,
        totalFee: summaryAgg._sum.actualFee ?? 0,
        totalTravel: summaryAgg._sum.travelOtherExpense ?? 0,
      }
    : undefined

  return NextResponse.json({ success: true, data, total, page, pageSize, summary })
}

const CaseSchema = z.object({
  caseNumber: z.string().optional(), // [2026/07/01] 可人工填入公證編號；留空則系統自動產生
  departmentId: z.number(),
  insuranceCompanyId: z.number(),
  brokerCompanyId: z.number().nullable().optional(),
  insuranceContact: z.string().min(1, '保險公司承辦人必填'),
  policyNumber: z.string(),
  insuredName: z.string(),
  incidentLocation: z.string(),
  incidentDate: z.string().min(1),  // FR-76 出險日期必填
  commissionDate: z.string(),
  insuranceType: z.string(),
  incidentCause: z.string(),
  estimatedAmount: z.number().nullable().optional(),
  coverageLimit: z.number().nullable().optional(),
  deductible: z.number().optional(),
  isSpecialCase: z.boolean().optional(),
  notes: z.string().optional(),
  coInsurers: z.array(z.object({
    companyId: z.number().nullable().optional(),
    policyNumber: z.string(),
    ratio: z.number(),
  })).optional(),
  assignments: z.array(z.object({
    employeeId: z.number(),
    role: z.string(),
    contributionRatio: z.number(),
  })).optional(),
  dispatchId: z.number().optional(),
  confirmDuplicate: z.boolean().optional(),  // FR-80 確認重複建檔後重送
  confirmDuplicateSeq: z.boolean().optional(), // [2026/08/04] - Lisa - FR-108 確認同群組流水號重複後重送
  contactFormStatus: z.string().optional(),
  contactReturnDate: z.string().nullable().optional(),
  nasFolder: z.string().optional(),
  parkingStatus: z.string().nullable().optional(),
  estimatedFee: z.number().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  // [2026/07/01] - Lisa - 改用 parseBody：驗證失敗回傳 400 JSON（含欄位訊息），不再 throw 成 500 非 JSON
  const parsed = await parseBody(req, CaseSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  // [2026/07/01] - Lisa - 新增案件開放所有角色（原限承辦人／行政人員）；已於上方確認登入

  // ── FR-44/76 後端驗證補強 ────────────────────────────────────────────
  const assignments = body.assignments ?? []
  if (assignments.length === 0) {
    return NextResponse.json({ success: false, error: '至少須指定一位承辦人' }, { status: 400 })
  }
  const primaryCount = assignments.filter((a) => a.role === '主辦').length
  if (primaryCount !== 1) {
    return NextResponse.json({ success: false, error: '承辦人須恰有一位主辦' }, { status: 400 })
  }
  const ratioTotal = assignments.reduce((s, a) => s + (a.contributionRatio || 0), 0)
  if (Math.abs(ratioTotal - 1.0) > 0.01) {
    return NextResponse.json({ success: false, error: '承辦比例合計須為 100%' }, { status: 400 })
  }

  // ── 共保資訊後端複驗（對齊前端：保單號碼／比例必填、合計須 < 100% 保留主保人比例）──
  const coInsurers = body.coInsurers ?? []
  for (const ci of coInsurers) {
    if (!ci.policyNumber?.trim()) {
      return NextResponse.json({ success: false, error: '共保保單號碼必填' }, { status: 400 })
    }
    if (!ci.ratio || ci.ratio <= 0) {
      return NextResponse.json({ success: false, error: '共保比例必填' }, { status: 400 })
    }
  }
  if (coInsurers.length > 0) {
    const coSum = coInsurers.reduce((s, c) => s + (c.ratio || 0), 0)
    if (coSum >= 100) {
      return NextResponse.json({ success: false, error: '共保比例合計已達 100%，主保人須保留比例' }, { status: 400 })
    }
  }

  const dept = await prisma.department.findUnique({
    where: { id: body.departmentId },
    include: { region: true },
  })
  if (!dept) return NextResponse.json({ success: false, error: '部門不存在' }, { status: 400 })

  const ic = await prisma.insuranceCompany.findUnique({ where: { id: body.insuranceCompanyId } })
  if (!ic) return NextResponse.json({ success: false, error: '保險公司不存在' }, { status: 400 })

  // ── FR-80 重複保單防護 ───────────────────────────────────────────────
  const dup = await prisma.case.findFirst({
    where: {
      insuranceCompanyId: body.insuranceCompanyId,
      policyNumber: body.policyNumber,
      status: { not: '銷案' },
    },
    select: { caseNumber: true },
  })
  if (dup && body.confirmDuplicate !== true) {
    return NextResponse.json(
      {
        success: false,
        error: `已有相同保險公司＋保單號碼的未銷案案件（${dup.caseNumber}），請確認是否重複建檔`,
        code: 'DUPLICATE_POLICY',
      },
      { status: 409 },
    )
  }

  // ── FR-08 公證編號格式 ───────────────────────────────────────────────
  // 格式：[公證編號代號][保司代碼][CO?]-[年度2碼][區域代號]-[三位流水號]
  // [2026/07/01] - Lisa - 區域代號改抓「區域基礎資料」的公證編號代號（Region.caseNoCode），不再 hardcode；
  // 未設定（null）時回退空字串（等同台北無區域段）
  const regionCode = dept.region.caseNoCode ?? ''
  // [2026/08/05] - Lisa - 年度取台北時間：伺服器 UTC 於元旦台北 00:00~08:00 仍是去年，會取到舊年度編號
  const year = String(taipeiNow().year()).slice(-2)
  const hasCoInsurance = !!(body.coInsurers && body.coInsurers.length > 0)
  const coTag = hasCoInsurance ? 'CO' : ''
  // [2026/07/01] - Lisa - 公證編號前綴改用「公證編號代號」(caseNoCode)；未設定時回退部門代碼
  const caseNoCode = dept.caseNoCode || dept.code
  // [2026/07/01] - Lisa - 序號 key = 公證編號代號＋區域代號＋年度；
  // 同業務線不同區域（如台北/台中/高雄工程部皆 NL）各自從 001 計號，不跨區共用
  const seqKey = `${caseNoCode}${regionCode}-${year}`

  // [2026/07/01] - Lisa - 公證編號可人工填入：有填則沿用並先檢查重複；留空則自動取號
  const manualCaseNumber = body.caseNumber?.trim()
  if (manualCaseNumber) {
    const dup = await prisma.case.findFirst({ where: { caseNumber: manualCaseNumber }, select: { id: true } })
    if (dup) {
      return NextResponse.json({ success: false, error: `公證編號「${manualCaseNumber}」已存在，請確認` }, { status: 409 })
    }
    // [2026/08/04] - Lisa - FR-108 同群組流水號重複警示（警示＋二次確認，不硬擋）。
    // caseNumber unique 只管完整字串，保司代碼不同即放行，故人工填號可造出同群組重號
    // （實例：NLCK-26K-114 與 NLFB-26K-114）。補登歷史案件確有需要沿用既定號碼，故僅提醒。
    const seqConflicts = await findSeqConflicts(prisma, manualCaseNumber, caseNoCode)
    if (seqConflicts.length > 0 && body.confirmDuplicateSeq !== true) {
      const parts = parseSeqParts(manualCaseNumber)
      return NextResponse.json(
        {
          success: false,
          error: `流水號 ${parts?.seq ?? ''} 在「${caseNoCode}${parts?.regionCode ?? ''}-${parts?.year ?? ''}」群組已被使用：${seqConflicts.join('、')}。同部門同年度流水號原則上不重複，確定仍要使用「${manualCaseNumber}」？`,
          code: 'DUPLICATE_SEQ',
        },
        { status: 409 },
      )
    }
  }

  const dispatchId = body.dispatchId

  let caseNumber = ''
  let newCaseId = 0

  try {
    const result = await prisma.$transaction(async (tx) => {
      // FR-06 取件/成案原子鎖定：若帶 dispatchId，先鎖定該派案
      let dispatchInfo: { createdAt: Date; assignerName: string } | null = null
      if (dispatchId) {
        const locked = await tx.dispatchQueue.updateMany({
          where: { id: dispatchId, status: { in: ['待取件', '已取件'] } },
          data: { status: '已成案', pickedBy: parseInt(session.sub), draftData: null },
        })
        if (locked.count === 0) {
          const err = new Error('此派案已被他人成案')
          ;(err as Error & { httpStatus?: number }).httpStatus = 409
          throw err
        }
        // 取派案資訊（派案人／派案時間），用於補寫「派案／取件」進度
        const entry = await tx.dispatchQueue.findUnique({
          where: { id: dispatchId },
          select: { createdAt: true, assigner: { select: { name: true } } },
        })
        if (entry) dispatchInfo = { createdAt: entry.createdAt, assignerName: entry.assigner.name }
      }

      // FR-08 取號：人工填入則沿用該號；否則原子遞增自動產生
      let generated: string
      if (manualCaseNumber) {
        generated = manualCaseNumber
        // 若人工號符合本部門/區域/年度的自動格式，將流水號計數器推進至其序號之後，
        // 避免日後自動取號回頭撞到此號
        const m = manualCaseNumber.match(/-(\d{3,})$/)
        if (m && manualCaseNumber.includes(`-${year}${regionCode}-`)) {
          const target = parseInt(m[1], 10) + 1
          const cur = await tx.caseNumberSeq.findUnique({ where: { deptCode: seqKey } })
          if (!cur) {
            await tx.caseNumberSeq.create({ data: { deptCode: seqKey, nextSeq: target } })
          } else if (cur.nextSeq < target) {
            await tx.caseNumberSeq.update({ where: { deptCode: seqKey }, data: { nextSeq: target } })
          }
        }
      } else {
        // 自動取號：先原子遞增計數器
        const seq = await tx.caseNumberSeq.upsert({
          where: { deptCode: seqKey },
          create: { deptCode: seqKey, nextSeq: 2 },
          update: { nextSeq: { increment: 1 } },
        })
        let candidate = seq.nextSeq - 1
        // [2026/07/01] - Lisa - 防重號自癒：計數器可能落後於既有資料（人工號/匯入/重灌造成），
        // 對齊到該部門/區域/年度實際最大序號 +1，避免自動號撞到既有案件而卡在交易回滾迴圈
        const sameKeyCases = await tx.case.findMany({
          where: { caseNumber: { startsWith: caseNoCode, contains: `-${year}${regionCode}-` } },
          select: { caseNumber: true },
        })
        let maxSeq = 0
        for (const r of sameKeyCases) {
          const mm = r.caseNumber.match(/-(\d+)$/)
          if (mm) { const n = parseInt(mm[1], 10); if (n > maxSeq) maxSeq = n }
        }
        if (candidate <= maxSeq) {
          candidate = maxSeq + 1
          await tx.caseNumberSeq.update({ where: { deptCode: seqKey }, data: { nextSeq: candidate + 1 } })
        }
        const seqNo = String(candidate).padStart(3, '0')
        generated = `${caseNoCode}${ic.code}${coTag}-${year}${regionCode}-${seqNo}`
      }

      const created = await tx.case.create({
        data: {
          caseNumber: generated,
          departmentId: body.departmentId,
          insuranceCompanyId: body.insuranceCompanyId,
          brokerCompanyId: body.brokerCompanyId,
          insuranceContact: body.insuranceContact,
          policyNumber: body.policyNumber,
          insuredName: body.insuredName,
          incidentLocation: body.incidentLocation,
          incidentDate: new Date(body.incidentDate),
          commissionDate: new Date(body.commissionDate),
          insuranceType: body.insuranceType,
          incidentCause: body.incidentCause,
          // [2026/07/01] - Lisa - 防呆：僅在有限整數時轉 BigInt，避免 NaN/浮點值讓 BigInt() throw 成 500 非 JSON
          estimatedAmount: Number.isFinite(body.estimatedAmount)
            ? BigInt(Math.trunc(body.estimatedAmount as number))
            : null,
          coverageLimit: Number.isFinite(body.coverageLimit)
            ? BigInt(Math.trunc(body.coverageLimit as number))
            : null,
          deductible: BigInt(Math.trunc(Number.isFinite(body.deductible) ? (body.deductible as number) : 0)),
          isSpecialCase: body.isSpecialCase ?? false,
          notes: body.notes,
          contactFormStatus: body.contactFormStatus,
          contactReturnDate: body.contactReturnDate ? new Date(body.contactReturnDate) : undefined,
          nasFolder: body.nasFolder,
          parkingStatus: body.parkingStatus,
          estimatedFee: body.estimatedFee,
          dispatchEntryId: dispatchId ?? undefined,
          coInsurers: body.coInsurers ? {
            create: body.coInsurers.map((ci) => ({
              companyId: ci.companyId,
              policyNumber: ci.policyNumber,
              ratio: ci.ratio,
            })),
          } : undefined,
          assignments: {
            create: assignments.map((a) => ({
              employeeId: a.employeeId,
              role: a.role,
              contributionRatio: a.contributionRatio,
            })),
          },
        },
      })

      // 進件/建檔進度：派案池取件成案時，取件即等同建檔，合併為單一筆，
      // 並帶入派案人／取件人，避免「案件建立」與「派案／取件」兩筆重覆。
      // 取件人若為主承辦人本人，標示「取件」；否則代表轉派他人主辦，標示「派件」。
      const pickerIsPrimary = assignments.some(
        (a) => a.role === '主辦' && a.employeeId === parseInt(session.sub),
      )
      const pickAction = pickerIsPrimary ? '取件' : '派件'
      const creationDescription = dispatchInfo
        ? `案件建立：派案 ${dispatchInfo.assignerName} → ${pickAction} ${session.name}`
        : `案件建立 (${session.name})`

      await tx.caseProgress.create({
        data: {
          caseId: created.id,
          stage: '進件/建檔',
          progressDate: new Date(),
          description: creationDescription,
          createdBy: parseInt(session.sub),
        },
      })

      await tx.caseLog.create({
        data: {
          caseId: created.id,
          employeeId: parseInt(session.sub),
          fieldName: '公證編號',
          logType: 'create',
          newValue: generated,
        },
      })

      // [2026/06/24] - Lisa - 派案通知：案件成立並指派承辦人 → 寫入站內通知（主辦＋協辦），與成案同交易
      await tx.notification.create({
        data: newAssignmentNotification(created.id, generated, body.insuredName),
      })

      return { id: created.id, caseNumber: generated }
    })
    newCaseId = result.id
    caseNumber = result.caseNumber
  } catch (e) {
    const status = (e as Error & { httpStatus?: number }).httpStatus
    if (status === 409) {
      return NextResponse.json({ success: false, error: (e as Error).message }, { status: 409 })
    }
    // [2026/07/01] - Lisa - 公證編號唯一鍵衝突（競態）→ 回 409
    if ((e as { code?: string }).code === 'P2002') {
      return NextResponse.json({ success: false, error: '公證編號重複，請確認後重試' }, { status: 409 })
    }
    throw e
  }

  // 立即通知（1）新派案 → 主承辦人＋協辦人；寄信失敗不影響成案結果
  await mailNewAssignment(newCaseId, caseNumber, body.insuredName)

  return NextResponse.json({ success: true, data: { id: newCaseId, caseNumber } }, { status: 201 })
}
