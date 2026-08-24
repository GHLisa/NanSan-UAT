// ── 公證費預付請款：依「出具日期」認列 ──────────────────────────────────────
// [2026/08/21] - Lisa - 客戶需求：「進度&中間報告書」／「中間簽結報告書」勾選
// 「公證費預付請款」者，該筆金額於出具日期所屬月份即認列，不必等案件結案；
// 案件結案時，結案月改用「actualFee − 該案累計已認列預付金額」，避免重複計入。
// 供已決案明細表／業績報表／首頁儀表板共用，統一口徑。
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

export const PREPAY_TYPE = '公證費預付請款'

function isPrepayReview(interimTypes: string | null): boolean {
  if (!interimTypes) return false
  try {
    const arr = JSON.parse(interimTypes) as string[]
    return Array.isArray(arr) && arr.includes(PREPAY_TYPE)
  } catch {
    return false
  }
}

// 案件累計「已出具」的公證費預付請款金額（reportIssuedAt 不為 null＝已通過審核流程並登錄出具）。
// 結案時用來從當月 actualFee 扣除，避免與先前已認列的月份重複計入。
export async function getPrepaidTotals(caseIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  if (caseIds.length === 0) return map
  const reviews = await prisma.caseReview.findMany({
    where: { caseId: { in: caseIds }, reportIssuedAt: { not: null } },
    select: { caseId: true, interimTypes: true, interimAmount: true },
  })
  for (const r of reviews) {
    if (!isPrepayReview(r.interimTypes) || !r.interimAmount) continue
    map.set(r.caseId, (map.get(r.caseId) ?? 0) + r.interimAmount)
  }
  return map
}

export type PrepayEvent = {
  caseId: number
  amount: number
  issuedAt: Date
  assignments: { employeeId: number; role: string; contributionRatio: number | null; employee: { name: string } }[]
}

// 期間內以「出具日期」認列的公證費預付請款事件（不限案件目前是否已結案）。
// caseWhere：呼叫端自訂的角色可視範圍（不含 status/closeDate，由呼叫端自行決定）。
export async function getPrepayEventsInRange(
  caseWhere: Prisma.CaseWhereInput,
  range: { gte: Date; lte: Date },
): Promise<PrepayEvent[]> {
  const reviews = await prisma.caseReview.findMany({
    where: {
      reportIssuedAt: { gte: range.gte, lte: range.lte },
      case: { is: caseWhere },
    },
    select: {
      caseId: true,
      interimTypes: true,
      interimAmount: true,
      reportIssuedAt: true,
      case: {
        select: {
          assignments: {
            select: { employeeId: true, role: true, contributionRatio: true, employee: { select: { name: true } } },
          },
        },
      },
    },
  })
  return reviews
    .filter((r) => isPrepayReview(r.interimTypes) && (r.interimAmount ?? 0) > 0)
    .map((r) => ({
      caseId: r.caseId,
      amount: r.interimAmount!,
      issuedAt: r.reportIssuedAt!,
      assignments: r.case.assignments,
    }))
}
