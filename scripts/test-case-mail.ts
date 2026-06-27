// ── 即時發信測試腳本 ─────────────────────────────────────────────────────
// 針對真實案件，實際呼叫 lib/caseMail.ts 的三個業務通知函式，
// 走的是與 API（指派 / 送審 / 退回）完全相同的路徑：
//   查 DB 解析收件人 → 組信 → sendMail（SMTP）。
//
// 執行方式（於 web-site 目錄下）：
//   npm run test:case-mail            # 預設用案件 #1
//   npm run test:case-mail -- 3       # 指定案件 id
//
// 注意：收件人來自資料庫實際承辦人 / 審核人的 email，會「真的寄出」。
//      本機 seed 已將所有員工 email 設為同一信箱，故可安全觀察。

import { config } from 'dotenv'
config({ path: '.env.local' })
config({ path: '.env' })

import { prisma } from '../lib/prisma'
import {
  mailNewAssignment,
  mailReviewSubmitted,
  mailReviewRejected,
} from '../lib/caseMail'

async function main() {
  if (!process.env.SMTP_HOST) {
    console.error('✗ 未設定 SMTP_HOST，將不會實際寄送。請先在 .env 設定 SMTP_*。')
    process.exit(1)
  }

  const caseId = Number(process.argv[2] ?? 1)
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    select: {
      id: true, caseNumber: true, insuredName: true,
      assignments: { select: { employee: { select: { name: true, email: true } } } },
    },
  })
  if (!c) {
    console.error(`✗ 找不到案件 #${caseId}`)
    process.exit(1)
  }

  // 取一位有 email 的員工當作「審核人」測試對象
  const reviewer = await prisma.employee.findFirst({
    where: { email: { not: null }, isActive: true },
    select: { id: true, name: true, email: true },
  })

  console.info(`→ 測試案件：#${c.id} ${c.caseNumber}　${c.insuredName}`)
  console.info('→ 承辦人收件：', c.assignments.map(a => `${a.employee.name}<${a.employee.email}>`).join(', ') || '(無)')
  console.info('→ 審核人收件：', reviewer ? `${reviewer.name}<${reviewer.email}>` : '(無)')
  console.info('─'.repeat(50))

  // (1) 新派案 → 主承辦人＋協辦人
  console.info('① 新派案通知 mailNewAssignment ...')
  await mailNewAssignment(c.id, c.caseNumber, c.insuredName)

  // (2) 文件送審 → 當前關卡審核人
  if (reviewer) {
    console.info('② 文件待審通知 mailReviewSubmitted ...')
    await mailReviewSubmitted(c.id, c.caseNumber, '出險通知書', reviewer.id)
  } else {
    console.warn('② 略過（查無審核人 email）')
  }

  // (3) 文件退回 → 主承辦人＋協辦人
  console.info('③ 文件退回通知 mailReviewRejected ...')
  await mailReviewRejected(c.id, c.caseNumber, '出險通知書', '測試退回原因：金額欄位需補正')

  console.info('─'.repeat(50))
  console.info('✓ 三封通知已送出（失敗會在上方以 [caseMail] 錯誤呈現）。請至信箱確認。')
}

main()
  .catch(e => { console.error('✗ 執行例外：', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
