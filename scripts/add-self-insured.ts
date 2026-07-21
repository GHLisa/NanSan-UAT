// ── 一次性（冪等）：於保險公司主檔新增「被保險人自保」列，供共保下拉選用 ──────────
// 前端已將此列自「主保險公司」下拉濾除，僅出現在共保公司下拉。
// 重複執行安全：已存在則略過。可對正式站 DB 執行同一支腳本。
//   npx tsx scripts/add-self-insured.ts
import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })
import { prisma } from '../lib/prisma'

const NAME = '被保險人自保'
const CODE = 'SELF'

async function main() {
  const existing = await prisma.insuranceCompany.findFirst({ where: { name: NAME } })
  if (existing) {
    console.log(`已存在（id=${existing.id}, code=${existing.code}），略過新增。`)
    return
  }
  const codeTaken = await prisma.insuranceCompany.findUnique({ where: { code: CODE } })
  const code = codeTaken ? `${CODE}${Date.now()}` : CODE
  const row = await prisma.insuranceCompany.create({ data: { code, name: NAME } })
  console.log(`✓ 已新增：id=${row.id}, code=${row.code}, name=${row.name}`)
}

main().catch(e => { console.error('✗', e); process.exit(1) }).finally(() => prisma.$disconnect())
