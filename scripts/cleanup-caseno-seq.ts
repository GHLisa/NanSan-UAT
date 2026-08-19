import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

// [2026/08/06] - Lisa - 一次性清理：刪除 case_number_seq 內「永不會再被命中」的廢種子。
//
// 刪除對象（兩類，皆需通過安全檢核才刪）：
//   A. 無年度段的舊 key 格式（2026-07-01 前 seqKey 僅部門代碼，如 NL / KB / CB）
//      → 現行 seqKey 一律為 `[caseNoCode][regionCode]-[年度2碼]`，此類永遠不會被 upsert 命中。
//      安全檢核：nextSeq === 1（從未取用過任何號）。
//   B. 前綴非現行任何部門 caseNoCode+區域組合（如 KL-26；高雄三部門 caseNoCode 已 backfill 為 NL/NB/NF）
//      安全檢核：無任何案件公證編號以該前綴開頭（號已全部釋出）。
//
// 不刪：合規但過去年度的種子（供一覽頁對帳，且 recomputeSeq 會重建）。
// 加 --apply 才真的刪除，否則僅試算。
const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

async function main() {
  console.log(`模式：${APPLY ? '★ 實際刪除 (--apply)' : '試算 (dry-run)'}`)
  console.log('DB：', (process.env.DATABASE_URL ?? '').replace(/\/\/[^@]*@/, '//***@').slice(0, 80))

  const depts = await prisma.department.findMany({
    select: { caseNoCode: true, code: true, region: { select: { caseNoCode: true } } },
  })
  const validPrefix = new Set(
    depts.map((d) => `${d.caseNoCode || d.code}${d.region.caseNoCode ?? ''}`),
  )

  const seqRows = await prisma.caseNumberSeq.findMany({ orderBy: { deptCode: 'asc' } })
  const caseNumbers = (await prisma.case.findMany({ select: { caseNumber: true } })).map((c) => c.caseNumber)

  const toDelete: { key: string; nextSeq: number; kind: string }[] = []
  const kept: string[] = []
  const blocked: string[] = []

  for (const r of seqRows) {
    const noYear = /^[A-Za-z]+$/.test(r.deptCode)
    const m = r.deptCode.match(/^([A-Za-z]+)-(\d{2})$/)

    if (noYear) {
      // A：安全檢核 —— 從未取用過任何號
      if (r.nextSeq === 1) toDelete.push({ key: r.deptCode, nextSeq: r.nextSeq, kind: 'A 無年度段舊 key' })
      else blocked.push(`${r.deptCode} (A 類但 nextSeq=${r.nextSeq} ≠ 1，曾取用過，保留待人工確認)`)
      continue
    }
    if (m && !validPrefix.has(m[1])) {
      // B：安全檢核 —— 無任何案件編號以該前綴開頭
      const used = caseNumbers.filter((n) => n.startsWith(m[1]))
      if (used.length === 0) toDelete.push({ key: r.deptCode, nextSeq: r.nextSeq, kind: `B 前綴 ${m[1]} 非現行組合` })
      else blocked.push(`${r.deptCode} (B 類但仍有 ${used.length} 筆案件使用該前綴：${used.slice(0, 3).join('、')}，保留)`)
      continue
    }
    kept.push(r.deptCode)
  }

  console.log(`\n現行合規前綴：${[...validPrefix].sort().join(', ')}`)
  console.log(`\n將刪除 ${toDelete.length} 筆：`)
  for (const d of toDelete) console.log(`  ${d.key.padEnd(8)} nextSeq=${String(d.nextSeq).padEnd(4)} ← ${d.kind}`)
  console.log(`\n保留 ${kept.length} 筆：${kept.join('、')}`)
  if (blocked.length) {
    console.log(`\n⚠ 未通過安全檢核、不刪除 ${blocked.length} 筆：`)
    for (const b of blocked) console.log(`  ${b}`)
  }

  if (!APPLY) {
    console.log('\n(dry-run，未變更資料。加 --apply 執行刪除)')
    return
  }

  const res = await prisma.caseNumberSeq.deleteMany({ where: { deptCode: { in: toDelete.map((d) => d.key) } } })
  console.log(`\n✔ 已刪除 ${res.count} 筆`)
  const after = await prisma.caseNumberSeq.findMany({ orderBy: { deptCode: 'asc' } })
  console.log(`刪除後共 ${after.length} 筆：`)
  for (const a of after) console.log(`  ${a.deptCode.padEnd(8)} nextSeq=${a.nextSeq}`)
}

main().finally(() => prisma.$disconnect())
