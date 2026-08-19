import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

// 一次性稽核腳本：檢查資料庫既有案件的公證編號是否符合 FR-08 規則
// 格式：[部門caseNoCode][保司代碼][CO?]-[年度2碼][區域代號]-[三位流水號]
const prisma = new PrismaClient()

async function main() {
  const url = process.env.DATABASE_URL ?? ''
  console.log('DB host:', url.replace(/\/\/[^@]*@/, '//***@').slice(0, 90))

  const cases = await prisma.case.findMany({
    select: {
      id: true,
      caseNumber: true,
      insuredName: true,
      status: true,
      commissionDate: true,
      department: {
        select: { name: true, code: true, caseNoCode: true, region: { select: { name: true, caseNoCode: true } } },
      },
      insuranceCompany: { select: { code: true, name: true } },
      coInsurers: { select: { id: true } },
    },
    orderBy: { id: 'asc' },
  })
  console.log(`\n案件總數：${cases.length}`)

  type Row = {
    id: number
    caseNumber: string
    insuredName: string
    dept: string
    expectPrefix: string
    issues: string[]
  }
  const bad: Row[] = []
  const groups = new Map<string, { caseNumber: string; id: number; seq: number }[]>()

  for (const c of cases) {
    const caseNoCode = c.department.caseNoCode || c.department.code
    const regionCode = c.department.region.caseNoCode ?? ''
    const ic = c.insuranceCompany.code
    const coTag = c.coInsurers.length > 0 ? 'CO' : ''
    const issues: string[] = []

    // 1) 整體格式
    const strict = new RegExp(`^${caseNoCode}${ic}(CO)?-(\\d{2})${regionCode}-(\\d{3})$`)
    const m = c.caseNumber.match(strict)
    if (!m) {
      // 逐段診斷
      const loose = c.caseNumber.match(/^([A-Za-z]+?)(CO)?-(\d{2})([A-Za-z]*)-(\d+)$/)
      if (!loose) {
        issues.push('格式不符：非 [代號][保司][CO?]-[年2碼][區域]-[3碼流水號]')
      } else {
        const [, head, co, yy, rg, seq] = loose
        if (head !== `${caseNoCode}${ic}`) {
          issues.push(`前綴不符：實際「${head}」 應為「${caseNoCode}${ic}」(部門${caseNoCode}+保司${ic})`)
        }
        if (rg !== regionCode) {
          issues.push(`區域代號不符：實際「${rg || '(空)'}」 應為「${regionCode || '(空)'}」(${c.department.region.name})`)
        }
        if (seq.length !== 3) issues.push(`流水號非三位：「${seq}」`)
        if ((co === 'CO') !== (coTag === 'CO')) {
          issues.push(coTag ? 'CO 標記缺漏：本案有共保保司' : 'CO 標記多餘：本案無共保保司')
        }
        void yy
      }
    }

    // 2) 年度與委託日期是否一致
    const ym = c.caseNumber.match(/-(\d{2})[A-Za-z]*-/)
    if (ym) {
      const yy = ym[1]
      const cy = String(c.commissionDate.getFullYear()).slice(-2)
      if (yy !== cy) issues.push(`年度與委託日期不符：編號 ${yy} / 委託 ${c.commissionDate.toISOString().slice(0, 10)}`)
    }

    // 3) 群組流水號重複
    const p = c.caseNumber.match(/-(\d{2})([A-Za-z]*)-0*(\d+)/)
    if (p) {
      const key = `${caseNoCode}${p[2].toUpperCase()}-${p[1]}`
      const arr = groups.get(key) ?? []
      arr.push({ caseNumber: c.caseNumber, id: c.id, seq: parseInt(p[3], 10) })
      groups.set(key, arr)
    }

    if (issues.length) {
      bad.push({
        id: c.id,
        caseNumber: c.caseNumber,
        insuredName: c.insuredName,
        dept: `${c.department.name}/${c.department.region.name}`,
        expectPrefix: `${caseNoCode}${ic}${coTag}-YY${regionCode}-NNN`,
        issues,
      })
    }
  }

  console.log(`\n===== 不符規則案件：${bad.length} 筆 =====`)
  for (const b of bad) {
    console.log(`\n#${b.id} ${b.caseNumber}  (${b.insuredName}) [${b.dept}]`)
    console.log(`   應為：${b.expectPrefix}`)
    for (const i of b.issues) console.log(`   - ${i}`)
  }

  console.log('\n===== 同群組流水號重複 =====')
  let dupCount = 0
  for (const [key, arr] of groups) {
    const bySeq = new Map<number, string[]>()
    for (const a of arr) bySeq.set(a.seq, [...(bySeq.get(a.seq) ?? []), a.caseNumber])
    for (const [seq, nums] of bySeq) {
      if (nums.length > 1) {
        dupCount++
        console.log(`  ${key} 流水號 ${seq}：${nums.join('、')}`)
      }
    }
  }
  if (!dupCount) console.log('  無')

  console.log('\n===== 計數器 (case_number_seq) 對照 =====')
  const seqs = await prisma.caseNumberSeq.findMany({ orderBy: { deptCode: 'asc' } })
  for (const s of seqs) {
    const arr = groups.get(s.deptCode) ?? []
    const maxSeq = arr.reduce((mx, a) => Math.max(mx, a.seq), 0)
    const ok = s.nextSeq === maxSeq + 1
    console.log(`  ${s.deptCode.padEnd(10)} nextSeq=${String(s.nextSeq).padEnd(5)} 實際max=${String(maxSeq).padEnd(5)} ${ok ? 'OK' : (s.nextSeq > maxSeq ? '偏高(可接受，號已釋出/跳號)' : '⚠ 偏低，自動取號會撞號')}`)
  }
  const keysWithoutSeq = [...groups.keys()].filter((k) => !seqs.some((s) => s.deptCode === k))
  if (keysWithoutSeq.length) console.log(`  ⚠ 有案件但無計數器的群組：${keysWithoutSeq.join('、')}`)

  console.log('\n===== 基礎資料 caseNoCode =====')
  const depts = await prisma.department.findMany({ select: { name: true, code: true, caseNoCode: true, region: { select: { name: true, caseNoCode: true } } }, orderBy: { id: 'asc' } })
  for (const d of depts) console.log(`  ${d.name.padEnd(12)} code=${d.code} caseNoCode=${d.caseNoCode ?? '(null→回退code)'} 區域=${d.region.name}(${d.region.caseNoCode ?? '(null→空)'})`)
}

main().finally(() => prisma.$disconnect())
