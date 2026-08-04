// ── 部門「公證編號代號」回填腳本（非破壞性、可重複執行）────────────────────
// 用途：將既有部門尚未設定的 case_no_code 補為其部門代碼 code。
//       不影響已設定值、不影響既有公證編號。
//
// 前置：需先 `npx prisma db push` 新增 case_no_code 欄位。
// 執行（於 web-site_UAT 目錄下）：npx tsx scripts/backfill-dept-caseno.ts
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const affected = await prisma.$executeRaw`
    UPDATE departments SET case_no_code = code WHERE case_no_code IS NULL
  `
  const rows = await prisma.department.findMany({
    select: { code: true, caseNoCode: true },
    orderBy: { id: 'asc' },
  })
  console.log(`本次回填 ${affected} 筆`)
  console.log('目前對照：', rows.map((r) => `${r.code}→${r.caseNoCode ?? '(null)'}`).join('  '))
}

main()
  .catch((e) => { console.error('❌ 回填失敗：', e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
