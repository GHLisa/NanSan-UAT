import type { JWTPayload } from '@/lib/auth'
import type { Prisma } from '@prisma/client'

// [2026/07/03] - Lisa - 出具報告作業查詢條件（比照 lib/reviewScope 集中組裝 where）

export type ReportIssueTab = 'pending' | 'issued'

/**
 * 「已通過整個審核流程」判定：
 * - recordStatus = null（未終結：非已重送 / 已放棄）
 * - 不需執行副總（requiresVP=false）→ 主管複核 reviewStatus='已核准' 即完成
 * - 需執行副總（requiresVP=true）  → approvalStatus='已核准'（加簽審核於副總前必已核准，故不需另判）
 */
export const APPROVED_REVIEW_WHERE: Prisma.CaseReviewWhereInput = {
  recordStatus: null,
  OR: [
    { requiresVP: false, reviewStatus: '已核准' },
    { requiresVP: true, approvalStatus: '已核准' },
  ],
}

/**
 * 依登入者角色 + Tab + 篩選建立出具報告清單查詢的 where。
 *
 * 角色可見範圍：
 * - sysadmin：全部
 * - admin_staff：有部門者限本部門、無部門者全公司
 *
 * Tab：
 * - pending：已通過審核流程且尚未出具（reportIssuedAt=null）
 * - issued ：已通過審核流程且已出具（reportIssuedAt<>null）
 *
 * dateFrom / dateTo（YYYY-MM-DD）：僅「已出具」分頁生效，依 reportIssuedAt 篩選出具日期區間。
 * 前端預設帶當年度，避免歷年資料一次載入造成負擔；「待出具」忽略日期參數，恆顯示全部。
 */
export function buildReportIssueWhere(
  session: JWTPayload,
  tab: ReportIssueTab,
  documentType?: string | null,
  keyword?: string | null,
  dateFrom?: string | null,
  dateTo?: string | null,
): Prisma.CaseReviewWhereInput {
  const { role, departmentId } = session

  const scopeWhere: Prisma.CaseReviewWhereInput =
    role === 'admin_staff' && departmentId != null ? { case: { departmentId } } : {}

  // reportIssuedAt 以 new Date('YYYY-MM-DD')（UTC 午夜）儲存，故起日取當日 00:00、訖日取當日 23:59:59 皆用 UTC
  const issuedDateFilter = (): Prisma.DateTimeNullableFilter => {
    const range: Prisma.DateTimeNullableFilter = {}
    if (dateFrom) range.gte = new Date(`${dateFrom}T00:00:00.000Z`)
    if (dateTo) range.lte = new Date(`${dateTo}T23:59:59.999Z`)
    return Object.keys(range).length > 0 ? range : { not: null }
  }

  const tabWhere: Prisma.CaseReviewWhereInput =
    tab === 'issued' ? { reportIssuedAt: issuedDateFilter() } : { reportIssuedAt: null }

  const docWhere: Prisma.CaseReviewWhereInput = documentType ? { documentType } : {}

  const keywordWhere: Prisma.CaseReviewWhereInput = keyword
    ? {
        case: {
          OR: [
            { caseNumber: { contains: keyword, mode: 'insensitive' } },
            { insuredName: { contains: keyword, mode: 'insensitive' } },
          ],
        },
      }
    : {}

  const parts = [APPROVED_REVIEW_WHERE, scopeWhere, tabWhere, docWhere, keywordWhere].filter(
    (w) => Object.keys(w).length > 0,
  )
  return parts.length > 0 ? { AND: parts } : {}
}
