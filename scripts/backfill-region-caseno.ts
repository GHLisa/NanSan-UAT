// ── 區域「公證編號代號」回填腳本（非破壞性、可重複執行）────────────────────
// 用途：將既有區域尚未設定（null）的 case_no_code 補為預設區域代號。
//       台北 TP→""、台中 TC→"T"、高雄 KH→"K"（含舊代碼相容）。
//       只補 null 值，不覆寫已設定者；不影響既有案件編號。
//
// 前置：需先 `npx prisma db push` 新增 case_no_code 欄位。
// 執行（於 web-site_UAT 目錄下）：npx tsx scripts/backfill-region-caseno.ts
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const CODE_MAP: Record<string, string> = {
  TP: '', TC: 'T', KH: 'K',           // seed v3.0 區域代碼
  NORTH: '', CENTRAL: 'T', SOUTH: 'K', // 舊代碼相容
}

async function main() {
  const regions = await prisma.region.findMany({ orderBy: { id: 'asc' } })
  let n = 0
  for (const r of regions) {
    if (r.caseNoCode === null) {               // 只補尚未設定者（含台北，會補為空字串）
      await prisma.region.update({ where: { id: r.id }, data: { caseNoCode: CODE_MAP[r.code] ?? '' } })
      n++
    }
  }
  const after = await prisma.region.findMany({ select: { code: true, caseNoCode: true }, orderBy: { id: 'asc' } })
  console.log(`本次回填 ${n} 筆`)
  console.log('目前對照：', after.map((r) => `${r.code}→"${r.caseNoCode ?? '(null)'}"`).join('  '))
}

main()
  .catch((e) => { console.error('❌ 回填失敗：', e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
