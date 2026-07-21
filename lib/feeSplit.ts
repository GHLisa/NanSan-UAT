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
