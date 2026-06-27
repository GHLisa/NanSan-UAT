// ── Email 寄送傳輸層 ─────────────────────────────────────────────────────
// 走 SMTP（以 nodemailer 連線寄送）。
// 設定（環境變數）：
//   SMTP_HOST    ── SMTP 主機，例：smtp.gmail.com、smtp.office365.com、mail.yourdomain.com
//   SMTP_PORT    ── 連接埠，465（SSL）或 587（STARTTLS）；預設 587
//   SMTP_SECURE  ── "true" 走 SSL（465 時用）；未設定時依 PORT 自動判斷（465→true）
//   SMTP_USER    ── 登入帳號
//   SMTP_PASS    ── 登入密碼 / 應用程式密碼
//   MAIL_FROM    ── 寄件者，例：南山公證案件管理系統 <noreply@yourdomain.com>
//                   未設定時退回使用 SMTP_USER
//   未設定 SMTP_HOST 時僅在 server log 記錄、不實際寄送（dev 友善）。
//
// 設計原則：
//   1. 收件人會去重、過濾無效 / 空白 email（對應需求 PS：無 email 不發送）。
//   2. 任何失敗都回傳結果物件而非拋例外，呼叫端不會因寄信失敗而中斷業務流程。
//   3. transporter 以模組層級單例快取，避免每次寄信重建連線。

import nodemailer, { type Transporter } from 'nodemailer'
import { decodeSecret } from './encryption'
import { prisma } from './prisma'

interface SendArgs {
  to: string[]
  cc?: string[]   // 副本收件人（同 to 去重、過濾無效 email）
  subject: string
  html: string
  text?: string
  // 稽核用（寫入 MailLog）：信件類別與關聯案件，皆選填
  category?: string
  caseId?: number | null
  caseNumber?: string | null
}

interface SendResult {
  ok: boolean
  sent: number      // 實際送出的收件人數
  skipped: number   // 因無有效 email 而略過的數量
  error?: string
}

// 寄件者：在函式內讀取，避免模組載入時序問題（dotenv / serverless 友善）
function fromAddress(): string {
  return process.env.MAIL_FROM ?? process.env.SMTP_USER ?? '南山公證案件管理系統'
}

// 系統測試階段：所有信件主旨統一在開頭加上「系統測試」前綴（已含則不重複）
const SUBJECT_PREFIX = '系統測試'
function withSubjectPrefix(subject: string): string {
  return subject.startsWith(SUBJECT_PREFIX) ? subject : `${SUBJECT_PREFIX} ${subject}`
}

let transporter: Transporter | null = null

function getTransporter(): Transporter | null {
  const host = process.env.SMTP_HOST
  if (!host) return null
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587)
    const secure = process.env.SMTP_SECURE
      ? process.env.SMTP_SECURE === 'true'
      : port === 465
    const user = process.env.SMTP_USER
    // SMTP_PASS 若已加密（已設定 SYS_KEY/SYS_IV）則解密；否則視為明文
    const rawPass = process.env.SMTP_PASS
    const pass = rawPass ? (decodeSecret(rawPass) ?? rawPass) : undefined
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
    })
  }
  return transporter
}

function normalizeRecipients(to: string[]): string[] {
  return Array.from(new Set((to ?? []).map(e => (e ?? '').trim()).filter(e => e.includes('@'))))
}

// 發信稽核：每次寄送嘗試寫入一筆 MailLog；best-effort，寫入失敗只記 log 不拋例外
async function recordMailLog(row: {
  category: string
  subject: string
  recipients: string[]
  status: 'sent' | 'skipped' | 'failed'
  sentCount: number
  skippedCount: number
  caseId?: number | null
  caseNumber?: string | null
  error?: string | null
  bodyHtml?: string | null
}): Promise<void> {
  try {
    await prisma.mailLog.create({
      data: {
        category: row.category,
        subject: row.subject,
        recipients: row.recipients.join(', '),
        status: row.status,
        sentCount: row.sentCount,
        skippedCount: row.skippedCount,
        caseId: row.caseId ?? null,
        caseNumber: row.caseNumber ?? null,
        error: row.error ?? null,
        bodyHtml: row.bodyHtml ?? null,
      },
    })
  } catch (e) {
    console.error('[email] 寫入 MailLog 失敗（不影響寄送）', e)
  }
}

export async function sendMail({
  to, cc, subject: rawSubject, html, text,
  category = 'other', caseId = null, caseNumber = null,
}: SendArgs): Promise<SendResult> {
  const recipients = normalizeRecipients(to)
  // 副本去重、且不與主收件人重複（避免同一人同時出現在 to/cc）
  const ccRecipients = normalizeRecipients(cc ?? []).filter(e => !recipients.includes(e))
  const allRecipients = [...recipients, ...ccRecipients]
  const subject = withSubjectPrefix(rawSubject)
  const logBase = { category, subject, caseId, caseNumber, bodyHtml: html }

  // PS 規則：主要通知對象（to）沒有 email → 不發送（僅有 cc 也不寄）
  if (recipients.length === 0) {
    console.warn('[email] 無有效收件人，略過寄送：', subject)
    await recordMailLog({ ...logBase, recipients: to ?? [], status: 'skipped', sentCount: 0, skippedCount: 1, error: '無有效收件人' })
    return { ok: true, sent: 0, skipped: 1 }
  }

  // 未設定 SMTP：dev 模式僅記錄，不實際寄送
  const tx = getTransporter()
  if (!tx) {
    console.info('[email][DEV] 未設定 SMTP_HOST，僅記錄不寄送：', { to: recipients, cc: ccRecipients, subject })
    await recordMailLog({ ...logBase, recipients: allRecipients, status: 'skipped', sentCount: 0, skippedCount: allRecipients.length, error: '未設定 SMTP_HOST，未實際寄送' })
    return { ok: true, sent: 0, skipped: 0 }
  }

  try {
    await tx.sendMail({ from: fromAddress(), to: recipients, cc: ccRecipients.length ? ccRecipients : undefined, subject, html, text })
    await recordMailLog({ ...logBase, recipients: allRecipients, status: 'sent', sentCount: allRecipients.length, skippedCount: 0 })
    return { ok: true, sent: allRecipients.length, skipped: 0 }
  } catch (e) {
    console.error('[email] 寄送例外', e)
    await recordMailLog({ ...logBase, recipients: allRecipients, status: 'failed', sentCount: 0, skippedCount: 0, error: String(e) })
    return { ok: false, sent: 0, skipped: 0, error: String(e) }
  }
}
