import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseSeqParts } from '@/lib/caseNumber'
// [2026/08/05] - Lisa - 年度取台北時間，與建案取號（api/cases POST）同一基準
import { taipeiNow } from '@/lib/sla'

// [2026/08/04] - Lisa - FR-108 建案取號現況提示。
// GET /api/cases/number-preview?departmentId=1
// 回傳該部門「當年度」流水號群組現況：自動取號會給的序號、已用至第幾號、空號清單、群組內重號。
// 目的：讓建案者在填表當下就看出「系統要給的號」與「紙本簿冊的下一號」是否一致，
// 不一致時直接填入正確編號，而非事後由行政人員用「公證編號修正」補救（FR-97）。
// 權限：僅需登入（建案本身已對所有角色開放；回傳內容為序號統計，不含案件內容）。

const GAP_LIMIT = 20 // 空號清單顯示上限（避免新部門第一年出現數百個空號洗版）

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const param = req.nextUrl.searchParams.get('departmentId')
  const departmentId = param ? parseInt(param) : session.departmentId
  if (!departmentId) {
    return NextResponse.json({ success: false, error: '缺少部門' }, { status: 400 })
  }

  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { name: true, code: true, caseNoCode: true, region: { select: { caseNoCode: true } } },
  })
  if (!dept) return NextResponse.json({ success: false, error: '部門不存在' }, { status: 400 })

  // 與建案取號完全同一組推導（api/cases POST）：caseNoCode 未設定時回退部門代碼
  const caseNoCode = dept.caseNoCode || dept.code
  const regionCode = dept.region.caseNoCode ?? ''
  const year = String(taipeiNow().year()).slice(-2)
  const seqKey = `${caseNoCode}${regionCode}-${year}`

  const [counter, rows] = await Promise.all([
    prisma.caseNumberSeq.findUnique({ where: { deptCode: seqKey } }),
    prisma.case.findMany({
      where: { caseNumber: { startsWith: caseNoCode, contains: `-${year}${regionCode}-` } },
      select: { caseNumber: true },
    }),
  ])

  // 統計群組內各流水號的使用情形（同一序號可能被多筆使用＝重號）
  const bySeq = new Map<number, string[]>()
  for (const r of rows) {
    const p = parseSeqParts(r.caseNumber)
    if (!p || p.year !== year || p.regionCode !== regionCode) continue
    const list = bySeq.get(p.seq) ?? []
    list.push(r.caseNumber)
    bySeq.set(p.seq, list)
  }
  const actualMax = bySeq.size ? Math.max(...bySeq.keys()) : 0

  // 自動取號實際會拿到的號：計數器與「實際最大＋1」取大者（對齊 POST /api/cases 的防重號自癒）
  const nextAuto = Math.max(counter?.nextSeq ?? 1, actualMax + 1)

  const gaps: number[] = []
  let gapCount = 0
  for (let i = 1; i < nextAuto; i++) {
    if (!bySeq.has(i)) {
      gapCount++
      if (gaps.length < GAP_LIMIT) gaps.push(i)
    }
  }
  const duplicates = [...bySeq.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([seq, list]) => ({ seq, caseNumbers: list }))

  return NextResponse.json({
    success: true,
    data: {
      seqKey,
      departmentName: dept.name,
      caseNoCode,
      regionCode,
      year,
      nextAuto,
      nextAutoText: String(nextAuto).padStart(3, '0'),
      usedTo: actualMax,          // 群組實際最大流水號（0＝今年尚無案件）
      usedCount: bySeq.size,      // 已使用的流水號個數
      gaps,                       // 空號（最多 GAP_LIMIT 個）
      gapCount,                   // 空號總數
      duplicates,                 // 群組內重號（供行政人員盤點）
    },
  })
}
