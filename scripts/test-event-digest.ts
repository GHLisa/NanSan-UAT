// ── 案件待辦彙整（事件批次）Sample 寄送腳本 ─────────────────────────────
// 以 lib/digestMail 的 buildEventDigestHtml 產生與正式信完全相同的版面，
// 直接寄給指定收件人（預設 lisa_chung@asiavista.com.tw），不碰事件佇列、不影響其他人。
//
// 執行（於 web-site_UAT 目錄下）：
//   npx tsx scripts/test-event-digest.ts
//   npx tsx scripts/test-event-digest.ts someone@example.com
//
// 注意：走真實 SMTP 寄出；主旨會自動帶「系統測試(UAT)」前綴；受寄信總開關 email_enabled 管控。

import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { prisma } from '../lib/prisma'
import { sendMail } from '../lib/email'
import { buildEventDigestHtml } from '../lib/digestMail'

async function main() {
  const email = process.argv[2] ?? 'lisa_chung@asiavista.com.tw'
  const to = `Lisa <${email}>`

  // 涵蓋四個分區的樣本事件（caseId 設 null → 顯示案號文字，避免 sample 連到不存在的案件）
  const sample = [
    { id: 1, eventType: 'new_assignment', caseId: null, caseNumber: 'NLHT26K-125', insuredName: '安林工程股份有限公司', documentType: null, remarks: null },
    { id: 2, eventType: 'new_assignment', caseId: null, caseNumber: 'NLHT26K-131', insuredName: '大同倉儲', documentType: null, remarks: null },
    { id: 3, eventType: 'assignment_changed', caseId: null, caseNumber: 'NLHT26K-118', insuredName: '國泰世紀產物', documentType: null, remarks: null },
    { id: 4, eventType: 'review_submitted', caseId: null, caseNumber: 'NLTC26F-042', insuredName: '遠東新世紀', documentType: '初步報告', remarks: null },
    { id: 5, eventType: 'review_cascade', caseId: null, caseNumber: 'NLKH26A-007', insuredName: '台塑石化', documentType: '正式報告', remarks: null },
    { id: 6, eventType: 'review_rejected', caseId: null, caseNumber: 'NLHT26K-090', insuredName: '中鋼運通', documentType: '正式報告', remarks: '出險原因描述不足，請補充現場照片與估價單。' },
  ]

  const html = buildEventDigestHtml(sample as Parameters<typeof buildEventDigestHtml>[0])

  console.info(`→ 寄送 sample「案件待辦彙整」至：${to}`)
  const r = await sendMail({
    to: [to],
    subject: `【案件待辦彙整】您有 ${sample.length} 則新通知`,
    html,
    category: 'event_digest',
  })
  console.info('寄送結果：', r)
}

main()
  .catch(e => { console.error('✗ 執行例外：', e); process.exit(1) })
  // sendMail 的 transporter 為連線池會保持 socket，須明確 exit 才不會卡住不結束
  .finally(async () => { await prisma.$disconnect(); process.exit(0) })
