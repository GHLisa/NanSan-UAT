// [2026/07/14] - Lisa - 報表年度歸戶規則：以「公證編號」中的年度為準（原本用委託日期 commissionDate）
// 公證編號格式：[前綴]-[年度2碼][區域代號]-[三位流水號]，例：NBFB-26K-093 → 26 → 2026
// 取中間段前 2 碼為西元年後兩碼；無法解析（人工填號 / 舊格式，如缺連字號的 NBHT26K-004）時，
// 回退委託日期年度，避免案件在報表中被漏計。
import dayjs from 'dayjs'

export function caseReportYear(
  caseNumber: string | null | undefined,
  commissionDate: Date | string,
): number {
  if (caseNumber) {
    const m = caseNumber.match(/-(\d{2})[A-Za-z]*-\d+$/)
    if (m) return 2000 + Number(m[1])
  }
  return dayjs(commissionDate).year()
}
