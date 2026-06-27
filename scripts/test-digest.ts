// ── 排程彙整手動測試腳本 ─────────────────────────────────────────────────
// 走與 Vercel Cron（/api/cron/daily-digest）完全相同的 lib/digestMail 路徑，
// 方便部署前在本機驗證收件人解析、燈號分類與信件內容。
//
// 執行方式（於 web-site 目錄下）：
//   npm run test:digest                 # 以「現在(台北)」為基準，星期一才跑每週部門報表
//   npm run test:digest -- 2026-06-22   # 模擬指定日期(視為當日台北 07:00)；星期一會自動含部門報表
//   npm run test:digest -- 2026-06-22 weekly   # 強制一併執行每週部門報表
//
// 注意：收件人來自資料庫實際 email，未設定 SMTP_HOST 時僅記錄不實際寄送（dev 友善）。

import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import dayjs from 'dayjs'
import { prisma } from '../lib/prisma'
import { runDailyDigest, runWeeklyDeptReport } from '../lib/digestMail'
import { taipeiNow } from '../lib/sla'

async function main() {
  const dateArg = process.argv[2]
  const forceWeekly = process.argv.includes('weekly')

  // 指定日期時視為「當日台北 07:00」；未指定則用當下台北時間
  const now = dateArg ? dayjs(`${dateArg}T07:00:00`) : taipeiNow()
  const isMonday = now.day() === 1

  if (!process.env.SMTP_HOST) {
    console.warn('⚠ 未設定 SMTP_HOST：以下僅模擬（不會實際寄出），結果會寫入 MailLog 為 skipped。')
  }
  console.info(`→ 基準日期：${now.format('YYYY-MM-DD (ddd)')}　星期一=${isMonday}`)
  console.info('─'.repeat(50))

  const daily = await runDailyDigest(now)
  console.info('① 每日彙整：', daily)

  if (isMonday || forceWeekly) {
    const weekly = await runWeeklyDeptReport(now)
    console.info('② 每週部門彙整：', weekly)
  } else {
    console.info('② 每週部門彙整：略過（非星期一，可加參數 weekly 強制執行）')
  }

  console.info('─'.repeat(50))
  console.info('✓ 完成。請至信箱 / MailLog 確認結果。')
}

main()
  .catch(e => { console.error('✗ 執行例外：', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
