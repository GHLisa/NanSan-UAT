// ── SLA 燈號共用模組 ─────────────────────────────────────────────────────
// 案件時效燈號的單一事實來源。儀表板 / 案件清單原各自內嵌相同邏輯，
// 排程彙整（lib/digestMail.ts）改抽出於此，確保與畫面顯示一致。
//
// 燈號規則（僅未決案件計算，其餘一律 normal）：
//   紅燈 = 未交初步報告且 D≥30，或（不論初報）未決 D≥90
//   黃燈 = 未交初步報告且 D≥14
//
// 所有函式皆以 `now` 參數注入「當下時間」，便於排程指定台北時區、亦利於測試。

import dayjs, { type Dayjs } from 'dayjs'

export type SlaStatus = 'red' | 'yellow' | 'normal'

// 台北時區固定 UTC+8（無日光節約）。排程於 23:00 UTC 觸發（=台北 07:00），
// 伺服器時鐘為 UTC，故 +8 小時換算為台北壁鐘時間後再取日期 / 星期。
export const TAIPEI_UTC_OFFSET_HOURS = 8

export function taipeiNow(base: Dayjs = dayjs()): Dayjs {
  return base.add(TAIPEI_UTC_OFFSET_HOURS, 'hour')
}

// 委辦日至今的「日曆天數」（去除時分秒，純以日為單位）
export function daysSinceCommission(commissionDate: Date, now: Dayjs): number {
  return now.startOf('day').diff(dayjs(commissionDate).startOf('day'), 'day')
}

export function getSlaStatus(
  commissionDate: Date,
  preliminaryReportDate: Date | null,
  status: string,
  now: Dayjs,
): SlaStatus {
  if (status !== '未決') return 'normal'
  const d = daysSinceCommission(commissionDate, now)
  if (!preliminaryReportDate && d >= 30) return 'red'
  if (d >= 90) return 'red'
  if (!preliminaryReportDate && d >= 14) return 'yellow'
  return 'normal'
}

// 是否「今日新進入黃燈」：未交初步報告且委辦日恰滿 14 天（今天剛跨入 D+14）
export function isNewlyYellowToday(
  commissionDate: Date,
  preliminaryReportDate: Date | null,
  status: string,
  now: Dayjs,
): boolean {
  if (status !== '未決') return false
  if (preliminaryReportDate) return false
  return daysSinceCommission(commissionDate, now) === 14
}
