// ── 一次性校正：歷史已決案的分潤金額改為新規則（協辦捨去、主辦吸收剩餘，加總＝純公證費）─
// 走 lib/feeSplit 相同邏輯，逐一比對 SettlementSplit.amount，只更新有變動者。
// 預設 dry-run（僅列出）；帶參數 apply 才實際寫入 DB。
//   npx tsx scripts/fix-settlement-splits.ts          # 試算，不寫入
//   npx tsx scripts/fix-settlement-splits.ts apply    # 實際更新
import { config } from 'dotenv'
config({ path: '.env.local' }); config({ path: '.env' })
import { prisma } from '../lib/prisma'
import { splitFeeByRatio } from '../lib/feeSplit'

const APPLY = process.argv.includes('apply')

async function main() {
  const settlements = await prisma.settlement.findMany({
    select: {
      id: true, totalFee: true,
      case: { select: { caseNumber: true, assignments: { select: { employeeId: true, role: true } } } },
      splits: {
        select: {
          id: true, employeeId: true, ratio: true, amount: true,
          assignment: { select: { role: true } },
          employee: { select: { name: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
  })

  type Upd = { splitId: number; from: number; to: number }
  const plan: { caseNumber: string; total: number; oldSum: number; updates: Upd[]; lines: string[] }[] = []
  let totalUpdates = 0

  for (const s of settlements) {
    if (s.splits.length === 0) continue
    const roleMap = new Map(s.case.assignments.map(a => [a.employeeId, a.role]))
    const roleOf = (sp: (typeof s.splits)[number]) => sp.assignment?.role ?? roleMap.get(sp.employeeId) ?? ''
    const newAmts = splitFeeByRatio(s.totalFee, s.splits, sp => sp.ratio ?? 0, sp => roleOf(sp) === '主辦')
    const oldSum = s.splits.reduce((a, sp) => a + sp.amount, 0)

    const updates: Upd[] = []
    const lines: string[] = []
    s.splits.forEach((sp, i) => {
      const changed = sp.amount !== newAmts[i]
      if (changed) updates.push({ splitId: sp.id, from: sp.amount, to: newAmts[i] })
      lines.push(
        `    ${roleOf(sp) || '—'}｜${sp.employee.name}（${Math.round((sp.ratio ?? 0) * 100)}%）　` +
        `${sp.amount.toLocaleString()}${changed ? `　→　${newAmts[i].toLocaleString()} (${newAmts[i]-sp.amount>0?'+':''}${newAmts[i]-sp.amount})` : '（不變）'}`,
      )
    })
    if (updates.length) {
      totalUpdates += updates.length
      plan.push({ caseNumber: s.case.caseNumber, total: s.totalFee, oldSum, updates, lines })
    }
  }

  console.log(`結算筆數：${settlements.length}｜需校正的案件：${plan.length} 件｜需更新的分潤列：${totalUpdates} 列`)
  console.log('─'.repeat(70))
  for (const p of plan) {
    console.log(`● ${p.caseNumber}　純公證費 ${p.total.toLocaleString()}（舊加總 ${p.oldSum.toLocaleString()}，差 ${p.oldSum-p.total>0?'+':''}${p.oldSum-p.total}）`)
    console.log(p.lines.join('\n'))
  }
  console.log('─'.repeat(70))

  if (!APPLY) {
    console.log('※ 目前為 dry-run，未寫入。確認無誤後以 `apply` 參數實際更新。')
    return
  }

  await prisma.$transaction(
    plan.flatMap(p => p.updates.map(u =>
      prisma.settlementSplit.update({ where: { id: u.splitId }, data: { amount: u.to } }),
    )),
  )
  console.log(`✓ 已更新 ${totalUpdates} 列分潤。`)

  // 驗證：所有結算的分潤加總是否 = totalFee
  const after = await prisma.settlement.findMany({ select: { totalFee: true, splits: { select: { amount: true } } } })
  const bad = after.filter(s => s.splits.length > 0 && s.splits.reduce((a, x) => a + x.amount, 0) !== s.totalFee)
  console.log(bad.length === 0 ? '✓ 驗證通過：所有結算分潤加總＝純公證費。' : `✗ 仍有 ${bad.length} 筆不一致，請檢查。`)
}

main().catch(e => { console.error('✗', e); process.exit(1) }).finally(() => prisma.$disconnect())
