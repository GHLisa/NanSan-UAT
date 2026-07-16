// ── 案件相關通知郵件（改為批次） ─────────────────────────────────────────
// [2026/07/15] - Lisa - 原「即時發送」改為批次：以下事件不再當下寄信，改寫入 mail_event_queue，
// 由 /api/cron/event-digest 於台北平日 08:00 / 16:00 依收件人彙整成單封信寄出，避免信件轟炸。
//   新派案 / 承辦人異動 → 主承辦人＋協辦人
//   文件送審 / 進入下一關 → 當前關卡審核人 / 下一關審核人
//   文件退回            → 主承辦人＋協辦人
// PS：站內即時通知（lib/caseNotify.ts 寫入 notification）維持即時，本檔僅改 email 節奏。
// 對外函式簽名不變，呼叫端（送審 / 退回 / 指派 API）無需調整；入列失敗只記 log、不拋例外。

import { prisma } from './prisma'
import { enqueueMailEvent } from './mailQueue'

// ── 收件人解析（一律過濾無 email 者，收件人帶上姓名顯示）─────────────────
// 回傳格式為 `姓名 <email>`，sendMail / nodemailer 會自動處理顯示名稱編碼。
function formatRecipient(name: string | null | undefined, email: string): string {
  return name ? `${name} <${email}>` : email
}

async function assigneeEmails(caseId: number): Promise<string[]> {
  const rows = await prisma.caseAssignment.findMany({
    where: { caseId },
    select: { employee: { select: { name: true, email: true } } },
  })
  return rows
    .filter(r => !!r.employee.email)
    .map(r => formatRecipient(r.employee.name, r.employee.email as string))
}

export async function emailsByIds(ids: (number | null | undefined)[]): Promise<string[]> {
  const valid = ids.filter((x): x is number => typeof x === 'number')
  if (valid.length === 0) return []
  const rows = await prisma.employee.findMany({
    where: { id: { in: valid }, isActive: true },
    select: { name: true, email: true },
  })
  return rows
    .filter(r => !!r.email)
    .map(r => formatRecipient(r.name, r.email as string))
}

export async function vpEmails(): Promise<string[]> {
  const roles = await prisma.employeeRole.findMany({ where: { role: 'vp' }, select: { employeeId: true } })
  return emailsByIds(roles.map(r => r.employeeId))
}

async function caseInsuredName(caseId: number): Promise<string | null> {
  const c = await prisma.case.findUnique({ where: { id: caseId }, select: { insuredName: true } })
  return c?.insuredName ?? null
}

// 將單一事件對多位收件人各入一列佇列；永不拋例外，確保業務交易不受影響
async function enqueueFor(
  recipients: string[],
  base: {
    eventType: string
    caseId: number
    caseNumber: string
    insuredName?: string | null
    documentType?: string | null
    remarks?: string | null
    mergedBilling?: boolean // [2026/07/15] - Lisa - 合併送審旗標
  },
): Promise<void> {
  if (recipients.length === 0) return
  try {
    await enqueueMailEvent(recipients.map(r => ({ ...base, recipient: r })))
  } catch (e) {
    console.error('[caseMail] 事件入列失敗：', base.eventType, base.caseNumber, e)
  }
}

// ── (1) 新派案 → 主承辦人＋協辦人 ───────────────────────────────────────
export async function mailNewAssignment(caseId: number, caseNumber: string, insuredName: string): Promise<void> {
  await enqueueFor(await assigneeEmails(caseId), { eventType: 'new_assignment', caseId, caseNumber, insuredName })
}

// 編輯模式新增/更換承辦人 → 通知當前全部承辦人（主辦＋協辦）
export async function mailAssignmentChanged(caseId: number, caseNumber: string, insuredName: string): Promise<void> {
  await enqueueFor(await assigneeEmails(caseId), { eventType: 'assignment_changed', caseId, caseNumber, insuredName })
}

// ── (2) 文件送審 → 當前關卡審核人 ───────────────────────────────────────
export async function mailReviewSubmitted(
  caseId: number,
  caseNumber: string,
  documentType: string,
  reviewerId: number,
  mergedBilling = false, // [2026/07/15] - Lisa - 合併送審旗標，供彙整信標示「合併送審 請款單DEBIT NOTE」
): Promise<void> {
  await enqueueFor(await emailsByIds([reviewerId]), {
    eventType: 'review_submitted', caseId, caseNumber, documentType, mergedBilling, insuredName: await caseInsuredName(caseId),
  })
}

// 文件通過後進入下一審核關卡 → 通知下一關審核人（加簽審核 / 執行副總）
export async function mailReviewCascade(
  caseId: number,
  caseNumber: string,
  documentType: string,
  to: string[],
  mergedBilling = false, // [2026/07/15] - Lisa - 合併送審旗標
): Promise<void> {
  await enqueueFor(to, {
    eventType: 'review_cascade', caseId, caseNumber, documentType, mergedBilling, insuredName: await caseInsuredName(caseId),
  })
}

// ── (3) 文件退回 → 主承辦人＋協辦人 ─────────────────────────────────────
export async function mailReviewRejected(
  caseId: number,
  caseNumber: string,
  documentType: string,
  remarks?: string | null,
): Promise<void> {
  await enqueueFor(await assigneeEmails(caseId), {
    eventType: 'review_rejected', caseId, caseNumber, documentType, remarks: remarks ?? null, insuredName: await caseInsuredName(caseId),
  })
}
