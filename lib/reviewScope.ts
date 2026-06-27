import type { JWTPayload } from '@/lib/auth'
import type { Prisma } from '@prisma/client'

export type ReviewTab = 'pending' | 'pendingVP'

/**
 * 依登入者角色 + Tab 建立文件審核（caseReview）查詢的 Prisma where 條件。
 *
 * 角色可見範圍（與 /api/reviews GET 一致）：
 * - vp / sysadmin：全部
 * - team_lead / dept_manager：本部門案件 OR 自己被指定為加簽審核（midApproverId）
 * - handler / admin_staff：自己被指派的案件
 *
 * Tab 篩選：
 * - pending：reviewStatus='待複核' OR（midApprovalStatus='待加簽審核' 且 midApproverId=自己）
 * - pendingVP：approvalStatus='待執行副總閱' 且 requiresVP=true
 *
 * /api/reviews（清單）與 /api/badge-counts（導覽列 badge）共用此函式，
 * 確保 badge 數字與審核頁預設 Tab 的件數一致。
 */
export function buildReviewWhere(
  session: JWTPayload,
  tab: ReviewTab,
): Prisma.CaseReviewWhereInput {
  const empId = parseInt(session.sub)
  const { role, departmentId } = session

  // ── 角色可見範圍 ────────────────────────────────────────────────
  let scopeWhere: Prisma.CaseReviewWhereInput = {}
  if (role === 'vp' || role === 'sysadmin') {
    scopeWhere = {}
  } else if (role === 'team_lead' || role === 'dept_manager') {
    scopeWhere = {
      OR: [
        ...(departmentId ? [{ case: { departmentId } }] : []),
        { midApproverId: empId },
      ],
    }
  } else if (role === 'handler' || role === 'admin_staff') {
    scopeWhere = {
      case: { assignments: { some: { employeeId: empId } } },
    }
  }

  // ── Tab 篩選 ────────────────────────────────────────────────────
  const tabWhere: Prisma.CaseReviewWhereInput =
    tab === 'pendingVP'
      ? { approvalStatus: '待執行副總閱', requiresVP: true }
      : {
          OR: [
            { reviewStatus: '待複核' },
            { midApprovalStatus: '待加簽審核', midApproverId: empId },
          ],
        }

  const parts = [scopeWhere, tabWhere].filter((w) => Object.keys(w).length > 0)
  return parts.length > 0 ? { AND: parts } : {}
}

/**
 * 登入者開啟「文件審核」時預設停留的 Tab：
 * 執行副總落在「待執行副總閱」，其餘角色落在「複核待辦」。
 * 導覽列 badge 計數以此 Tab 為準。
 */
export function defaultReviewTab(role: string): ReviewTab {
  return role === 'vp' ? 'pendingVP' : 'pending'
}
