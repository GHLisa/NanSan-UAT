export function getMenuPermissions(role: string): string[] {
  const base = ['dashboard', 'cases', 'settlements', 'notifications', 'admin-fee']
  const perRole: Record<string, string[]> = {
    handler: [...base, 'dispatch', 'reviews', 'reports', 'case-detail-report'],
    team_lead: [...base, 'dispatch', 'reviews', 'fee-target', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report'],
    dept_manager: [...base, 'dispatch', 'reviews', 'fee-target', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report'],
    vp: [...base, 'dispatch', 'reviews', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report'],
    // [2026/07/01] - Lisa - 基礎資料開放行政人員：admin（顯示系統管理群組）＋ admin-master（僅基礎資料子項）
    // [2026/07/02] - Lisa - 公證編號修正（admin-case-number）開放行政人員
    // [2026/07/03] - Lisa - 出具報告作業（report-issue）開放行政人員
    admin_staff: [...base, 'dispatch', 'reviews', 'report-issue', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report', 'admin', 'admin-master', 'admin-users', 'admin-case-number'],
    // sysadmin 需列出各子項 key（選單改為逐子項授權），維持全項開放
    // [2026/07/02] - Lisa - 新增公證編號修正 admin-case-number
    // [2026/07/03] - Lisa - 出具報告作業 report-issue
    // [2026/07/07] - Lisa - sysadmin 開放側邊選單所有功能（含查詢統計群組與業績設定）
    sysadmin: [...base, 'dispatch', 'reviews', 'report-issue', 'fee-target', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report', 'admin', 'admin-users', 'admin-master', 'admin-case-number', 'admin-maillog', 'admin-loginlog', 'admin-settings'],
  }
  return perRole[role] ?? base
}

export function canReview(role: string): boolean {
  return ['team_lead', 'dept_manager', 'vp'].includes(role)
}

export function canDispatch(role: string): boolean {
  return ['dept_manager', 'vp', 'admin_staff'].includes(role)
}

// [2026/07/09] - Lisa - 費率表編輯（新增/修改/刪除）開放行政人員（原僅 sysadmin）
export function canManageFeeRates(role: string): boolean {
  return ['sysadmin', 'admin_staff'].includes(role)
}
