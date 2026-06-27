export function getMenuPermissions(role: string): string[] {
  const base = ['dashboard', 'cases', 'settlements', 'notifications', 'admin-fee']
  const perRole: Record<string, string[]> = {
    handler: [...base, 'dispatch', 'reviews', 'reports', 'case-detail-report'],
    team_lead: [...base, 'dispatch', 'reviews', 'fee-target', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report'],
    dept_manager: [...base, 'dispatch', 'reviews', 'fee-target', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report'],
    vp: [...base, 'dispatch', 'reviews', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report'],
    admin_staff: [...base, 'dispatch', 'reviews', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report'],
    sysadmin: [...base, 'dispatch', 'reviews', 'admin'],
  }
  return perRole[role] ?? base
}

export function canReview(role: string): boolean {
  return ['team_lead', 'dept_manager', 'vp'].includes(role)
}

export function canDispatch(role: string): boolean {
  return ['dept_manager', 'vp', 'admin_staff'].includes(role)
}
