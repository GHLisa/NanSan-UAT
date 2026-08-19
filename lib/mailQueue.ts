// ── 即時信事件佇列 ───────────────────────────────────────────────────────
// 原「即時發送」的通知（新派案 / 承辦人異動 / 送審 / 轉呈 / 退回）改為先入此佇列，
// 由 /api/cron/event-digest 於台北平日 08:00 / 16:00 依收件人彙整成單封信寄出，避免信件轟炸。
// 一個事件對多位收件人時，各收件人各存一列，方便依收件人分組彙整。

import { prisma } from './prisma'

export interface MailEventInput {
  eventType: string          // new_assignment / assignment_changed / review_submitted / review_cascade / review_rejected / review_approved
  caseId?: number | null
  caseNumber: string
  insuredName?: string | null
  documentType?: string | null
  remarks?: string | null    // 文件退回原因 / 核准之審核意見
  mergedBilling?: boolean     // [2026/07/15] - Lisa - 合併送審旗標，供彙整信標示「合併送審 請款單DEBIT NOTE」
  recipient: string          // 收件人「姓名 <email>」
}

export async function enqueueMailEvent(rows: MailEventInput[]): Promise<void> {
  if (rows.length === 0) return
  await prisma.mailEventQueue.createMany({
    data: rows.map(r => ({
      eventType: r.eventType,
      caseId: r.caseId ?? null,
      caseNumber: r.caseNumber,
      insuredName: r.insuredName ?? null,
      documentType: r.documentType ?? null,
      remarks: r.remarks ?? null,
      mergedBilling: r.mergedBilling ?? false,
      recipient: r.recipient,
    })),
  })
}
