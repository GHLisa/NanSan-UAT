import { prisma } from '@/lib/prisma'
import type { JWTPayload } from '@/lib/auth'
import type { Prisma } from '@prisma/client'

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
