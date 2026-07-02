import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// 公證編號修正——流水序號一覽（第 2 分頁）
// 列出所有 CaseNumberSeq 種子（seqKey → nextSeq），並掃描實際案件推導各群組實際最大序號，
// 供核對計數器是否與實際資料一致（承接「修正後 max+1 重算」的驗證需求）。
const ALLOWED_ROLES = ['sysadmin', 'admin_staff']

// 由案件的部門／區域基礎資料 + 編號中段年度推導 seqKey（與建案取號、修正重算一致）
function deriveSeqKey(caseNumber: string, caseNoCode: string, regionCode: string): string | null {
  const parts = caseNumber.split('-')
  if (parts.length < 3) return null
  const ym = parts[1].match(/^(\d{2})/)
  if (!ym) return null
  return `${caseNoCode}${regionCode}-${ym[1]}`
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
  }

  // 1) 取所有計數器種子
  const seqRows = await prisma.caseNumberSeq.findMany({ orderBy: { deptCode: 'asc' } })
  const storedMap = new Map(seqRows.map((r) => [r.deptCode, r.nextSeq]))

  // 2) 掃描所有案件，依當前部門／區域推導 seqKey，統計各群組實際最大序號
  const cases = await prisma.case.findMany({
    select: {
      caseNumber: true,
      department: { select: { caseNoCode: true, code: true, region: { select: { caseNoCode: true } } } },
    },
  })

  const actualMaxMap = new Map<string, number>()
  for (const c of cases) {
    const caseNoCode = c.department.caseNoCode || c.department.code
    const regionCode = c.department.region.caseNoCode ?? ''
    const seqKey = deriveSeqKey(c.caseNumber, caseNoCode, regionCode)
    if (!seqKey) continue
    const mm = c.caseNumber.match(/-(\d+)$/)
    if (!mm) continue
    const n = parseInt(mm[1], 10)
    const cur = actualMaxMap.get(seqKey) ?? 0
    if (n > cur) actualMaxMap.set(seqKey, n)
  }

  // 3) 合併種子與實際群組（可能有種子無對應案件、或案件群組無種子）
  const allKeys = Array.from(new Set([...storedMap.keys(), ...actualMaxMap.keys()])).sort()

  const rows = allKeys.map((seqKey) => {
    const nextSeq = storedMap.get(seqKey) ?? null           // 下一個將取用的序號（計數器）
    const usedTo = nextSeq != null ? nextSeq - 1 : null      // 已取用至（最後一號）
    const actualMax = actualMaxMap.get(seqKey) ?? 0          // 實際案件最大序號
    let status: 'in_sync' | 'behind' | 'ahead' | 'no_seed'
    if (nextSeq == null) status = 'no_seed'                  // 有案件但無計數器（下次建案會自癒）
    else if (usedTo === actualMax) status = 'in_sync'        // 一致
    else if (usedTo! < actualMax) status = 'behind'          // 計數器落後（下次建案自癒）
    else status = 'ahead'                                    // 計數器超前（曾跳號／刪案）
    return { seqKey, nextSeq, usedTo, actualMax, status }
  })

  return NextResponse.json({ success: true, data: rows })
}
