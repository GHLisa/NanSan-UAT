import { prisma } from '@/lib/prisma'
import type { JWTPayload } from '@/lib/auth'
import type { Prisma } from '@prisma/client'
import { ENG_TAIPEI_DEPT_CODES, KHH_ENG_DEPT_CODES } from '@/lib/approvalFlow'
import { getKhhFireSpecialCaseViewerIds } from '@/lib/settings'

// 高雄火險部部門代碼（見 prisma/seed.ts：高雄火險部 code='KF'）
const KHH_FIRE_DEPT_CODE = 'KF'

/**
 * 依登入者角色建立案件可視範圍的 Prisma where 條件（FR-19 v2.1/v2.3）。
 *
 * - handler：自己被指派之案件（不限部門）。
 *   [2026/06/24] - Lisa - 原 v2.3 加 departmentId 做「跨部門隔離」，但 Issue #5 已為案件清單/
 *   myCaseCount badge 拿掉部門限制；此處同步拿掉，使通知清單/未讀數/儀表板皆涵蓋跨部門協辦案件，
 *   三者範圍一致（assignments.some 已限縮為本人承辦，無越權風險）。
 * - team_lead：同部門＋同組別（查同 departmentId+teamGroup 的 employeeRole 取得 employeeIds，
 *              再以 assignments 過濾）；teamGroup 為空時 fallback 整部門
 * - dept_manager：所屬部門全部案件
 * - vp / admin_staff / sysadmin：全公司（不加條件）
 *
 * 注意：team_lead 需查詢資料庫取得同組員工 id，故為 async。
 */
export async function buildCaseScopeWhere(
  session: JWTPayload | null,
): Promise<Prisma.CaseWhereInput> {
  if (!session) return {}
  const { role, departmentId } = session

  // 全公司範圍（vp/sysadmin 一律全公司）
  // [2026/06/18] - Lisa - 行政人員改依部門：有部門→本部門、無部門→全公司（不再一律全公司）
  if (role === 'vp' || role === 'sysadmin') return {}

  // [2026/06/24] - Lisa - 承辦人可視範圍＝自己被指派之案件（不限部門），對齊 Issue #5 / myCaseCount badge，
  // 使跨部門協辦案件之通知/未讀數/儀表板預警皆可見（須早於下方 departmentId 缺漏判斷）
  if (role === 'handler') {
    return { assignments: { some: { employeeId: parseInt(session.sub) } } }
  }

  // 缺少部門資訊時無法套用部門級過濾，視為無可視案件以避免越權
  if (!departmentId) {
    return {}
  }

  if (role === 'team_lead') {
    const teamGroup = session.teamGroup
    if (!teamGroup) {
      // 組別為空時 fallback 整部門
      return { departmentId }
    }
    const groupRoles = await prisma.employeeRole.findMany({
      where: { departmentId, teamGroup },
      select: { employeeId: true },
    })
    const ids = [...new Set(groupRoles.map(r => r.employeeId))]
    return {
      departmentId,
      assignments: { some: { employeeId: { in: ids } } },
    }
  }

  // dept_manager（及其他部門級角色）：所屬部門全部案件
  return { departmentId }
}

/**
 * [2026/09/15] - Lisa - 高雄工程部部門主管為台北/台中工程部特殊案件（isSpecialCase）三關卡加簽
 * 審核者（FR-90），客戶希望其在「案件管理清單」也能一併看到這些案件（併入本部門範圍，唯讀）。
 *
 * 僅限 role='dept_manager' 且其所屬部門為高雄工程部時回傳額外的 OR 條件；其餘情況回傳 null，
 * 呼叫端應維持原本部門範圍不變。刻意不併入 buildCaseScopeWhere()——該函式同時供儀表板 KPI、
 * 通知未讀數、達成率等統計共用，若一併套用會讓高雄工程部的案件量/業績被台北案件污染；
 * 僅供「案件管理清單」與其 Excel 匯出（兩者資料範圍本應一致）呼叫。
 *
 * 唯讀：本函式只放寬「查得到」的範圍，編輯/刪除/交辦事項等操作仍由各自 API 既有的
 * `session.departmentId === case.departmentId` 嚴格比對把關，不受此處影響。
 */
export async function getCrossDeptSpecialCaseWhere(
  session: { role: string; departmentId: number | null } | null,
): Promise<Prisma.CaseWhereInput | null> {
  if (!session || session.role !== 'dept_manager' || !session.departmentId) return null
  const dept = await prisma.department.findUnique({
    where: { id: session.departmentId },
    select: { code: true },
  })
  if (!dept || !KHH_ENG_DEPT_CODES.includes(dept.code)) return null
  return { department: { code: { in: ENG_TAIPEI_DEPT_CODES } }, isSpecialCase: true }
}

/**
 * [2026/09/22] - Lisa - FR-120：高雄火險部特殊案件指定可視人員（系統參數設定維護）。
 *
 * 與上方 getCrossDeptSpecialCaseWhere()（FR-90，限 dept_manager 角色）不同，本設定指定的是
 * 「特定員工」而非角色，且不限該員工的角色／所屬部門——只要登入者 id 在系統參數設定的
 * 名單內，即可在「案件管理清單」（及其 Excel 匯出）額外看到高雄火險部之特殊案件。
 *
 * 同樣刻意不併入 buildCaseScopeWhere()（避免污染儀表板 KPI／通知未讀數等統計範圍），且僅放寬
 * 「查得到」，編輯/刪除/送審等操作仍由各自 API 既有的權限判斷把關（唯讀擴大可視範圍）。
 *
 * 呼叫端須注意：handler 角色的案件清單另有「僅列自己被指派案件」的專屬覆寫邏輯，套用本函式時
 * 需以 OR 併入該條件而非直接以 AND 疊加，否則會反而限縮（見 app/api/cases/route.ts 的用法）。
 */
export async function getDesignatedSpecialCaseWhere(
  session: { sub: string } | null,
): Promise<Prisma.CaseWhereInput | null> {
  if (!session) return null
  const empId = parseInt(session.sub)
  if (Number.isNaN(empId)) return null
  const viewerIds = await getKhhFireSpecialCaseViewerIds()
  if (!viewerIds.includes(empId)) return null
  return { department: { code: KHH_FIRE_DEPT_CODE }, isSpecialCase: true }
}

/**
 * [2026/09/15] - Lisa - 安全併入以 OR 表示的範圍條件（例如上面 getCrossDeptSpecialCaseWhere() 的
 * 回傳值）到既有的可變 where 物件。
 *
 * 背景：案件清單／匯出 API 慣例上把 where.OR 留給關鍵字搜尋、where.AND 留給各種 alert 篩選，兩者
 * 都用「直接覆寫」（where.OR = [...] / where.AND = [...]），因為過去只有它們會用到這兩個鍵。
 * 若把部門範圍條件直接展開成 where.OR，會被關鍵字搜尋的 where.OR 覆寫掉，等同該次查詢不限部門
 * ——這正是「李國鈞（高雄工程部主管）能查到非本部門、非特殊案件」的成因。
 *
 * 因此範圍條件一律改包進 where.AND（此函式），呼叫端所有原本「where.AND = [...]」的地方也要
 * 一併改成呼叫本函式疊加，而非覆寫，兩邊都做才不會有一邊蓋掉另一邊。
 */
export function addAndCondition(where: Record<string, unknown>, ...conditions: Record<string, unknown>[]) {
  const existing = Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []
  where.AND = [...existing, ...conditions]
}

/**
 * 通知可視範圍（FR-84）：通知清單／未讀數／全部已讀共用。
 * [2026/06/24] - Lisa - 支援兩種觸達：
 *   1. 指定收件人 targetEmployeeId = 登入者（不受角色/案件範圍限制，用於精準通知審核人）
 *   2. 角色廣播 targetEmployeeId=null + targetRoles 含當前角色 + 案件屬可視範圍（含 caseId=null 全域）
 */
export async function buildNotificationVisibilityWhere(
  session: JWTPayload,
): Promise<Prisma.NotificationWhereInput> {
  const empId = parseInt(session.sub)
  const scopeWhere = await buildCaseScopeWhere(session)
  return {
    OR: [
      { targetEmployeeId: empId },
      {
        targetEmployeeId: null,
        targetRoles: { contains: session.role },
        OR: [{ caseId: null }, { case: { is: scopeWhere } }],
      },
    ],
  }
}

/**
 * 取得統計範圍標籤文字（顯示於儀表板 KPI/圖表標題）。
 */
export function getCaseScopeLabel(session: JWTPayload | null): string {
  if (!session) return '全公司'
  const { role, departmentId, departmentName, teamGroup, name } = session
  if (role === 'vp' || role === 'sysadmin') return '全公司'
  // [2026/06/18] - Lisa - 行政人員：有部門→部門名、無部門→全公司
  if (role === 'admin_staff') return departmentId ? (departmentName ?? '本部門') : '全公司'
  if (role === 'handler') return name
  if (role === 'team_lead' && teamGroup) return `${departmentName ?? ''} ${teamGroup}`
  return departmentName ?? '本部門'
}

/**
 * 取得角色達成率彙總的 scope 員工 id 清單（FR-19 年度達成率）。
 *
 * - handler：自己
 * - team_lead：同部門同組別的 handler（對齊 demo DashboardPage 邏輯）
 * - dept_manager：本部門 handler + team_lead
 * - vp / admin_staff / sysadmin：全公司在職員工
 */
export async function getScopeEmployeeIds(session: JWTPayload | null): Promise<number[]> {
  if (!session) return []
  const { role, departmentId } = session

  if (role === 'handler') return [parseInt(session.sub)]

  if (role === 'team_lead') {
    if (!departmentId) return []
    const rows = await prisma.employeeRole.findMany({
      where: { departmentId, teamGroup: session.teamGroup ?? undefined, role: 'handler' },
      select: { employeeId: true },
    })
    return [...new Set(rows.map(r => r.employeeId))]
  }

  // [2026/06/18] - Lisa - 行政人員有部門時比照部門主管（本部門 handler+team_lead）；無部門→全公司
  if (role === 'dept_manager' || (role === 'admin_staff' && departmentId)) {
    if (!departmentId) return []
    const rows = await prisma.employeeRole.findMany({
      where: { departmentId, role: { in: ['handler', 'team_lead'] } },
      select: { employeeId: true },
    })
    return [...new Set(rows.map(r => r.employeeId))]
  }

  // vp / sysadmin / 無部門行政人員：全公司在職員工
  const rows = await prisma.employee.findMany({
    where: { isActive: true },
    select: { id: true },
  })
  return rows.map(r => r.id)
}
