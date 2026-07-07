// ── 案件相關「立即發送」郵件 ──────────────────────────────────────────────
// 需求（1）立即發送：
//   新派案   → 通知主承辦人及協辦人
//   文件送審 → 通知審核人員（部門主管 / 加簽審核 / 執行副總，依當前關卡）
//   文件退回 → 通知主承辦人及協辦人
// PS：通知對象無 email 則不發送（由 lib/email.ts 與此處的過濾共同保證）。
//
// 所有對外函式皆以 safeSend 包裝：寄信失敗只記 log，不拋例外，
// 確保呼叫端（送審 / 退回 / 指派 API）的業務交易不受影響。

import { prisma } from './prisma'
import { sendMail } from './email'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

function caseLink(caseId: number): string {
  return APP_URL ? `${APP_URL.replace(/\/$/, '')}/cases/${caseId}` : ''
}

function wrap(title: string, lines: string[], caseId: number): string {
  const link = caseLink(caseId)
  const linkHtml = link
    ? `<p style="margin:16px 0"><a href="${link}" style="background:#1B4F8C;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none">前往案件</a></p>`
    : ''
  return `<div style="font-family:'Microsoft JhengHei',sans-serif;font-size:14px;color:#1A202C;line-height:1.6">
    <h2 style="color:#1B4F8C;margin:0 0 12px">${title}</h2>
    ${lines.map(l => `<p style="margin:4px 0">${l}</p>`).join('')}
    ${linkHtml}
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
    <p style="color:#888;font-size:12px">南山公證案件管理系統自動通知，請勿直接回覆此信。</p>
  </div>`
}

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

// 安全寄送：永不拋例外。meta 帶入信件類別與關聯案件，供 MailLog 稽核
async function safeSend(
  to: string[],
  subject: string,
  html: string,
  meta: { category: string; caseId?: number; caseNumber?: string },
): Promise<void> {
  try {
    const r = await sendMail({ to, subject, html, ...meta })
    if (!r.ok) console.error('[caseMail] 寄送失敗：', subject, r.error)
  } catch (e) {
    console.error('[caseMail] 寄送例外：', subject, e)
  }
}

// ── (1) 新派案 → 主承辦人＋協辦人 ───────────────────────────────────────
export async function mailNewAssignment(caseId: number, caseNumber: string, insuredName: string): Promise<void> {
  const to = await assigneeEmails(caseId)
  if (to.length === 0) return
  await safeSend(
    to,
    `【新派案】${caseNumber}　${insuredName}`,
    wrap('您有新的承辦案件', [`案號：${caseNumber}`, `被保險人：${insuredName}`, '請至系統查看案件詳情並開始處理。'], caseId),
    { category: 'new_assignment', caseId, caseNumber },
  )
}

// [2026/06/24] - Lisa - 編輯模式新增/更換承辦人 → 通知當前全部承辦人（主辦＋協辦）
export async function mailAssignmentChanged(caseId: number, caseNumber: string, insuredName: string): Promise<void> {
  const to = await assigneeEmails(caseId)
  if (to.length === 0) return
  await safeSend(
    to,
    `【承辦人異動】${caseNumber}　${insuredName}`,
    wrap('案件承辦人已異動', [`案號：${caseNumber}`, `被保險人：${insuredName}`, '本案承辦人已變更，請至系統確認您的承辦狀態。'], caseId),
    { category: 'assignment_changed', caseId, caseNumber },
  )
}

// 出險日期格式：YYYY/MM/DD（Asia/Taipei，避免 UTC 位移造成日期偏移）
function fmtIncidentDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(d)
    .replace(/-/g, '/')
}

// 審核通知信共用抬頭：公證編號 / 出險日期 / 被保險人 / 出險地點 / 文件類型
async function reviewHeaderLines(caseId: number, caseNumber: string, documentType: string): Promise<string[]> {
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    select: { insuredName: true, incidentDate: true, incidentLocation: true },
  })
  return [
    `公證編號：${caseNumber}`,
    ...(c
      ? [`出險日期：${fmtIncidentDate(c.incidentDate)}`, `被保險人：${c.insuredName}`, `出險地點：${c.incidentLocation}`]
      : []),
    `文件類型：${documentType}`,
  ]
}

// ── (2) 文件送審 → 當前關卡審核人 ───────────────────────────────────────
export async function mailReviewSubmitted(
  caseId: number,
  caseNumber: string,
  documentType: string,
  reviewerId: number,
): Promise<void> {
  const to = await emailsByIds([reviewerId])
  if (to.length === 0) return
  const lines = await reviewHeaderLines(caseId, caseNumber, documentType)
  await safeSend(
    to,
    `【文件待審】${caseNumber}　${documentType}`,
    wrap('有文件待您審核', [...lines, '此文件已送至您的審核關卡，請至系統進行審核。'], caseId),
    { category: 'review_submitted', caseId, caseNumber },
  )
}

// 文件通過後進入下一審核關卡 → 通知下一關審核人（加簽審核 / 執行副總）
export async function mailReviewCascade(
  caseId: number,
  caseNumber: string,
  documentType: string,
  to: string[],
): Promise<void> {
  if (to.length === 0) return
  const lines = await reviewHeaderLines(caseId, caseNumber, documentType)
  await safeSend(
    to,
    `【文件待審】${caseNumber}　${documentType}`,
    wrap('有文件進入您的審核關卡', [...lines, '此文件已通過前一關卡，請至系統進行審核。'], caseId),
    { category: 'review_cascade', caseId, caseNumber },
  )
}

// ── (3) 文件退回 → 主承辦人＋協辦人 ─────────────────────────────────────
export async function mailReviewRejected(
  caseId: number,
  caseNumber: string,
  documentType: string,
  remarks?: string | null,
): Promise<void> {
  const to = await assigneeEmails(caseId)
  if (to.length === 0) return
  const lines = await reviewHeaderLines(caseId, caseNumber, documentType)
  await safeSend(
    to,
    `【文件退回】${caseNumber}　${documentType}`,
    wrap('您的送審文件已被退回', [
      ...lines,
      remarks ? `退回原因：${remarks}` : '請查看退回原因並修正後重新送審。',
    ], caseId),
    { category: 'review_rejected', caseId, caseNumber },
  )
}
