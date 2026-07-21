// ── 一次性：寄送「每日案件提醒」新版樣張（含停泊案件分區）給指定收件人 ─────────
// 內容取自某主承辦人目前實際承辦之未決案件（走 lib/digestMail 相同渲染邏輯），
// 僅寄給指定 email 供預覽格式，不影響正式排程、不寄給承辦人本人。
//
// 執行：npx tsx scripts/send-sample-digest.ts
import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { prisma } from '../lib/prisma'
import { sendMail } from '../lib/email'
import { buildHandlerDigestSample } from '../lib/digestMail'
import { taipeiNow } from '../lib/sla'

const HANDLER = '李國鈞'
const TO = 'lisa_chung@asiavista.com.tw'

async function main() {
  const sample = await buildHandlerDigestSample(HANDLER, taipeiNow())
  if (!sample) {
    console.error(`✗ 找不到主辦為「${HANDLER}」的未決案件，無法產生樣張。`)
    process.exit(1)
  }
  console.info(`→ ${HANDLER} 目前未決 ${sample.caseCount} 件`)
  console.info(`  主旨：${sample.subject}`)
  console.info(`  收件人：${TO}`)

  const banner =
    `<div style="font-family:'Microsoft JhengHei',sans-serif;background:#FFF7E6;border:1px solid #FFD591;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#874D00">` +
    `【樣張示意】本信為「每日案件提醒」新版（新增文末「⏸️ 停泊案件」分區）之格式樣張，` +
    `內容取自 <b>${HANDLER}</b> 目前實際承辦之未決案件，僅寄送給您預覽版面，並非正式排程通知，承辦人本人不會收到本封。` +
    `</div>`

  const r = await sendMail({
    to: [TO],
    subject: `【樣張】${sample.subject}`,
    html: banner + sample.html,
    category: 'sample_digest',
  })
  console.info('寄送結果：', r)
  if (!r.ok || r.sent === 0) {
    console.error('✗ 未實際寄出，請檢查 SMTP / 寄信總開關 / 收件人。')
    process.exit(1)
  }
  console.info('✓ 已寄出，請至信箱確認。')
}

main()
  .catch(e => { console.error('✗ 執行例外：', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
