// ── 出險原因基礎資料回填腳本（非破壞性、可重複執行）──────────────────────
// 用途：將 cases 表中「實際使用過」的 distinct incidentCause，加上原本前端寫死
//       的 9 個預設值，upsert 進 incident_causes 表（依 name unique，已存在略過）。
//       不會刪除或修改任何既有資料。
//
// 前置：需先 `npx prisma db push` 建立 incident_causes 表。
// 執行（於 web-site_UAT 目錄下）：
//   npx tsx scripts/seed-incident-causes.ts
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// 原前端寫死的預設出險原因
const DEFAULTS = [
  '本體損壞', '火災', '水災', '第三人損害', '施工意外',
  '機械故障', '電氣損壞', '竊盜', '其他',
]

async function main() {
  // 1. 既有案件實際用過的出險原因（distinct、去空白）
  const rows = await prisma.case.findMany({
    where: { incidentCause: { not: '' } },
    select: { incidentCause: true },
    distinct: ['incidentCause'],
  })
  const fromCases = rows.map((r) => (r.incidentCause ?? '').trim()).filter(Boolean)

  // 2. 合併預設值 + 案件實際值，去重（預設在前）
  const names = Array.from(new Set([...DEFAULTS, ...fromCases]))

  // 3. createMany + skipDuplicates（依 name unique 冪等，不覆寫既有 isActive）
  const before = await prisma.incidentCause.count()
  const result = await prisma.incidentCause.createMany({
    data: names.map((name) => ({ name, isActive: true })),
    skipDuplicates: true,
  })
  const after = await prisma.incidentCause.count()

  console.log(`候選出險原因 ${names.length} 筆（其中案件實際值 ${fromCases.length} 種）`)
  console.log(`案件實際值：${fromCases.join('、') || '（無）'}`)
  console.log(`本次新增 ${result.count} 筆；incident_causes 原有 ${before} → 現有 ${after}`)
}

main()
  .catch((e) => {
    console.error('❌ 回填失敗：', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
