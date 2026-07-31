import type { Prisma } from '@prisma/client'

// [2026/07/31] - Lisa - 公證編號序號計數器共用邏輯。
// 原為 app/api/admin/case-number/route.ts 內的 private function，因「銷案案件刪除」也需在刪除後
// 重算計數器（讓釋出的編號可經人工填號重用），抽出至此共用；請勿複製第二份 —— 這兩個函式封裝的是
// 公證編號格式規則，複製後日後改格式必漏改一邊。

/**
 * 依公證編號推導 seqKey（比照建案取號規則）。
 * 公證編號格式：[caseNoCode][保司代碼][CO?]-[年度2碼][區域代號]-[三位流水號]
 * seqKey = `${caseNoCode}${regionCode}-${year}`；caseNoCode / regionCode 取自案件當前
 * 的部門／區域基礎資料（與建案 route 一致），year 由編號中段解析。
 * 若編號非自動格式（人工自訂）而無法解析年度，回傳 null（該號不屬任何計數器群組）。
 */
export function deriveSeqKey(
  caseNumber: string,
  caseNoCode: string,
  regionCode: string,
): { seqKey: string; year: string } | null {
  const parts = caseNumber.split('-')
  if (parts.length < 3) return null
  const ym = parts[1].match(/^(\d{2})/)
  if (!ym) return null
  const year = ym[1]
  return { seqKey: `${caseNoCode}${regionCode}-${year}`, year }
}

/**
 * 重算單一 seqKey 計數器 → 該群組實際最大流水號 + 1。
 *
 * 本函式為「無條件正確」：掃描 cases 現況取 maxSeq 後設 nextSeq = maxSeq + 1，因此
 *   - 刪除的是該群組最後一號 → maxSeq 下降 → 計數器自動退回（編號釋出）
 *   - 刪除的是中間號         → maxSeq 不變 → 計數器不動（no-op，中間空號由人工填號回收）
 * 呼叫端毋須自行判斷「是否為最後一號」，但**必須在案件實刪之後、同一個 transaction 內呼叫**，
 * 否則被刪的案件仍計入 maxSeq，計數器不會退回。
 */
export async function recomputeSeq(
  tx: Prisma.TransactionClient,
  seqKey: string,
  caseNoCode: string,
  regionCode: string,
  year: string,
): Promise<{ seqKey: string; nextSeq: number }> {
  const rows = await tx.case.findMany({
    where: { caseNumber: { startsWith: caseNoCode, contains: `-${year}${regionCode}-` } },
    select: { caseNumber: true },
  })
  let maxSeq = 0
  for (const r of rows) {
    const mm = r.caseNumber.match(/-(\d+)$/)
    if (mm) {
      const n = parseInt(mm[1], 10)
      if (n > maxSeq) maxSeq = n
    }
  }
  const nextSeq = maxSeq + 1
  await tx.caseNumberSeq.upsert({
    where: { deptCode: seqKey },
    create: { deptCode: seqKey, nextSeq },
    update: { nextSeq },
  })
  return { seqKey, nextSeq }
}
