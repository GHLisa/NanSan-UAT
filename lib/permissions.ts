export function getMenuPermissions(role: string): string[] {
  const base = ['dashboard', 'cases', 'settlements', 'notifications', 'admin-fee']
  const perRole: Record<string, string[]> = {
    handler: [...base, 'dispatch', 'reviews', 'reports', 'case-detail-report'],
    team_lead: [...base, 'dispatch', 'reviews', 'fee-target', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report'],
    dept_manager: [...base, 'dispatch', 'reviews', 'fee-target', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report'],
    vp: [...base, 'dispatch', 'reviews', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report'],
    // [2026/07/01] - Lisa - 基礎資料開放行政人員：admin（顯示系統管理群組）＋ admin-master（僅基礎資料子項）
    admin_staff: [...base, 'dispatch', 'reviews', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report', 'admin', 'admin-master'],
    // sysadmin 需列出各子項 key（選單改為逐子項授權），維持四項全開
    sysadmin: [...base, 'dispatch', 'reviews', 'admin', 'admin-users', 'admin-master', 'admin-maillog', 'admin-loginlog'],
  }
  return perRole[role] ?? base
}

export function canReview(role: string): boolean {
  return ['team_lead', 'dept_manager', 'vp'].includes(role)
}

export function canDispatch(role: string): boolean {
  return ['dept_manager', 'vp', 'admin_staff'].includes(role)
}
