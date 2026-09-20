// ── 純公證費依承辦比例分攤 ────────────────────────────────────────────────
// 問題：各處各自 Math.round(金額 × 比例) 獨立進位，會使「同一案各人份額加總 ≠ 純公證費」。
// 規則（Lisa 2026-07-21，Q1=B）：非主辦者一律無條件捨去(floor)，主辦吸收剩餘 →
//   份額加總「必等於」total，且主辦只多不少。找不到主辦時，以清單第一位為吸收者。
//
// 回傳與 items 同順序的整數金額陣列；純前端/後端皆可使用（無任何 server 相依）。
export function splitFeeByRatio<T>(
  total: number,
  items: T[],
  ratioOf: (t: T) => number,
  isPrimaryOf: (t: T) => boolean,
): number[] {
  if (items.length === 0) return []
  let absorber = items.findIndex(isPrimaryOf)
  if (absorber < 0) absorber = 0
  const base = total || 0
  const amounts = items.map((it, i) =>
    // +1e-6：修正浮點誤差（如 100 × 0.29 = 28.9999999996 應為 29），不會跨越真實整數邊界
    i === absorber ? 0 : Math.floor(base * (ratioOf(it) || 0) + 1e-6),
  )
  const others = amounts.reduce((s, v, i) => (i === absorber ? s : s + v), 0)
  amounts[absorber] = base - others
  return amounts
}

// ── FR-119（v3.19）：結案分潤支援「金額輸入」模式 ──────────────────────────
// 案件層級二選一（Case.feeAllocationMode）：'AMOUNT' 時直接採各承辦人手動輸入的
// CaseAssignment.fixedAmount（不重算、加總不要求等於 total）；否則（'RATIO'／未設定）
// 沿用既有 splitFeeByRatio 比例分攤，行為完全不變。
export function getFeeSplit<T>(
  total: number,
  items: T[],
  ratioOf: (t: T) => number,
  isPrimaryOf: (t: T) => boolean,
  mode: string | null | undefined,
  fixedAmountOf: (t: T) => number | null | undefined,
): number[] {
  if (mode === 'AMOUNT') return items.map((it) => fixedAmountOf(it) ?? 0)
  return splitFeeByRatio(total, items, ratioOf, isPrimaryOf)
}
