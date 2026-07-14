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
import { isEmailEnabled } from './settings'

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

// 系統測試階段：所有信件主旨統一在開頭加上「系統測試(UAT)」前綴（已含則不重複）
const SUBJECT_PREFIX = '系統測試(UAT)'
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
      // [2026/07/15] - Lisa - 每日彙整會在同一秒連發數十封信，觸發 HiNet「452 Too many recipients
      // received from the sender」速率節流。開啟連線池並限制寄送速率，把突發洪峰壓平在門檻之下；
      // 搭配 sendMail 內的暫時性錯誤退避重試，確保偶發被節流的信會補送成功。
      pool: true,
      maxConnections: 1,   // 單一連線序列化寄送，避免併發爆量
      maxMessages: 100,    // 單一連線寄滿 100 封後重建，釋放伺服器端 session 計數
      rateDelta: 1000,     // 速率視窗：每 1 秒
      rateLimit: 5,        // 每個視窗最多 5 封（保守值，可依 HiNet 實際門檻調整）
    })
  }
  return transporter
}

function normalizeRecipients(to: string[]): string[] {
  return Array.from(new Set((to ?? []).map(e => (e ?? '').trim()).filter(e => e.includes('@'))))
}

// ── 暫時性錯誤退避重試 ───────────────────────────────────────────────────
const MAX_ATTEMPTS = 3               // 首次 + 最多 2 次重試
const BACKOFF_MS = [0, 3000, 6000]   // 各次嘗試前的等待（第 1 次不等）

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 解析 SMTP 錯誤碼：優先取 nodemailer 的 responseCode，否則從錯誤訊息擷取 3 碼
function smtpCode(e: unknown): number | null {
  const anyE = e as { responseCode?: number; message?: string }
  if (typeof anyE?.responseCode === 'number') return anyE.responseCode
  const m = String(anyE?.message ?? e ?? '').match(/\b([45]\d\d)\b/)
  return m ? parseInt(m[1], 10) : null
}

// 錯誤分類：暫時性（可重試）/ 永久性（不重試）
//   - SMTP 4xx（421/450/451/452 等，含 HiNet 速率節流）→ 暫時性
//   - 連線層錯誤（逾時 / 連線中斷 / DNS 解析）           → 暫時性
//   - SMTP 5xx（信箱不存在、內容被拒等）                → 永久性
function classifyError(e: unknown): { transient: boolean; label: string } {
  const code = smtpCode(e)
  const netCode = (e as { code?: string })?.code
  const netTransient = ['ETIMEDOUT', 'ECONNRESET', 'ESOCKET', 'ECONNECTION', 'ECONNREFUSED', 'EDNS', 'EAI_AGAIN', 'EGREETING']
  const msg = String((e as { message?: string })?.message ?? '')

  if (code !== null && code >= 400 && code < 500) {
    const isRate = code === 452 || /too many|rate|frequen|throttl/i.test(msg)
    return { transient: true, label: isRate ? `暫時性·速率限制(${code})` : `暫時性(${code})` }
  }
  if (typeof netCode === 'string' && netTransient.includes(netCode)) {
    return { transient: true, label: `暫時性·連線(${netCode})` }
  }
  if (code !== null && code >= 500) return { transient: false, label: `永久性(${code})` }
  return { transient: false, label: '永久性' }
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

  // [2026/07/15] - Lisa - 系統參數「是否啟動寄信功能」總開關：非 Y 時全系統停止寄信，僅記錄略過
  if (!(await isEmailEnabled())) {
    console.info('[email] 寄信功能已關閉（系統參數設定），略過寄送：', subject)
    await recordMailLog({ ...logBase, recipients: allRecipients, status: 'skipped', sentCount: 0, skippedCount: allRecipients.length, error: '寄信功能已關閉（系統參數設定）' })
    return { ok: true, sent: 0, skipped: allRecipients.length }
  }

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

  // 逐次嘗試：暫時性錯誤（如 HiNet 452 速率節流、連線逾時）退避後重試；永久性錯誤立即停止
  let lastErr: unknown = null
  let lastClass: { transient: boolean; label: string } | null = null
  let attempts = 0

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt
    if (attempt > 1) await sleep(BACKOFF_MS[attempt - 1] ?? 6000)
    try {
      await tx.sendMail({ from: fromAddress(), to: recipients, cc: ccRecipients.length ? ccRecipients : undefined, subject, html, text })
      // 若曾重試才成功，於備註記錄，供發信紀錄稽核
      const note = attempt > 1
        ? `第 ${attempt} 次嘗試寄送成功（前 ${attempt - 1} 次遇${lastClass?.label ?? '暫時性錯誤'}）`
        : null
      await recordMailLog({ ...logBase, recipients: allRecipients, status: 'sent', sentCount: allRecipients.length, skippedCount: 0, error: note })
      return { ok: true, sent: allRecipients.length, skipped: 0 }
    } catch (e) {
      lastErr = e
      lastClass = classifyError(e)
      console.error(`[email] 寄送失敗（第 ${attempt}/${MAX_ATTEMPTS} 次・${lastClass.label}）：`, subject, e)
      if (!lastClass.transient) break   // 永久性錯誤不重試
    }
  }

  // 全部嘗試皆失敗：錯誤訊息前綴分類標籤，讓發信紀錄一眼分辨暫時性/永久性
  const suffix = lastClass?.transient ? `（共嘗試 ${attempts} 次仍失敗）` : ''
  const errMsg = `[${lastClass?.label ?? '永久性'}] ${String(lastErr)}${suffix}`
  await recordMailLog({ ...logBase, recipients: allRecipients, status: 'failed', sentCount: 0, skippedCount: 0, error: errMsg })
  return { ok: false, sent: 0, skipped: 0, error: errMsg }
}
