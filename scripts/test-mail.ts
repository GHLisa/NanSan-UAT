// ── SMTP 寄信測試腳本 ────────────────────────────────────────────────────
// 用途：在設定好 SMTP_* 環境變數後，實際寄一封測試信驗證連線與帳密。
//
// 執行方式（於 web-site 目錄下）：
//   npm run test:mail -- you@example.com
//   或：npx tsx scripts/test-mail.ts you@example.com
//
// 收件人來源（依序）：
//   1. 命令列第一個參數
//   2. 環境變數 TEST_MAIL_TO
//   3. 退回使用 SMTP_USER（寄給自己）
//
// 會載入 .env / .env.local（透過 dotenv），再呼叫與正式相同的 lib/email.ts。

import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { sendMail } from '../lib/email'

async function main() {
  const to = process.argv[2] || process.env.TEST_MAIL_TO || process.env.SMTP_USER
  if (!to) {
    console.error('✗ 找不到收件人。請帶入參數，例：npm run test:mail -- you@example.com')
    process.exit(1)
  }

  if (!process.env.SMTP_HOST) {
    console.error('✗ 未設定 SMTP_HOST，將不會實際寄送（dev 模式只記 log）。請先在 .env 設定 SMTP_*。')
    process.exit(1)
  }

  console.info('→ 連線設定：', {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ?? '587(預設)',
    secure: process.env.SMTP_SECURE ?? '(依 PORT 自動判斷)',
    user: process.env.SMTP_USER,
    from: process.env.MAIL_FROM ?? process.env.SMTP_USER,
  })
  console.info('→ 寄送至：', to)

  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
  const result = await sendMail({
    to: [to],
    subject: `【測試信】南山公證案件管理系統 SMTP 設定驗證 ${now}`,
    html: `<div style="font-family:'Microsoft JhengHei',sans-serif;font-size:14px;color:#1A202C;line-height:1.6">
      <h2 style="color:#1B4F8C;margin:0 0 12px">SMTP 設定驗證成功</h2>
      <p>若您收到這封信，代表 SMTP 寄信設定正確。</p>
      <p style="color:#888;font-size:12px">寄送時間：${now}</p>
    </div>`,
    text: `SMTP 設定驗證成功。若您收到這封信，代表設定正確。寄送時間：${now}`,
  })

  if (result.ok && result.sent > 0) {
    console.info(`✓ 寄送成功，共 ${result.sent} 位收件人。請至信箱確認。`)
  } else if (result.ok && result.sent === 0) {
    console.warn('△ 未實際寄送（可能無有效收件人或未設定 SMTP_HOST）。', result)
  } else {
    console.error('✗ 寄送失敗：', result.error)
    process.exit(1)
  }
}

main().catch(e => {
  console.error('✗ 執行例外：', e)
  process.exit(1)
})
