import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
// [2026/07/31] - Lisa - deriveSeqKey / recomputeSeq 抽至 lib/caseNumber 共用（銷案刪除亦需重算計數器）
import { deriveSeqKey, recomputeSeq, findSeqConflicts, parseSeqParts } from '@/lib/caseNumber'

// 公證編號修正（系統管理）— sysadmin / 行政人員可用
// GET  ?keyword=  依公證編號或被保險人搜尋案件（供選取欲修正的案件）
// PATCH { id, newCaseNumber }  修正公證編號，並同步 MailLog 快照、重算受影響 seqKey 計數器
const ALLOWED_ROLES = ['sysadmin', 'admin_staff']

function assertRole(role: string): boolean {
  return ALLOWED_ROLES.includes(role)
}

// ── GET：搜尋案件 ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (!assertRole(session.role)) return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const keyword = (req.nextUrl.searchParams.get('keyword') ?? '').trim()
  if (!keyword) return NextResponse.json({ success: true, data: [] })

  const where: Prisma.CaseWhereInput = {
    OR: [
      { caseNumber: { contains: keyword, mode: 'insensitive' } },
      { insuredName: { contains: keyword, mode: 'insensitive' } },
    ],
  }

  const rows = await prisma.case.findMany({
    where,
    select: {
      id: true,
      caseNumber: true,
      insuredName: true,
      status: true,
      commissionDate: true,
      department: { select: { name: true } },
    },
    orderBy: { commissionDate: 'desc' },
    take: 20,
  })

  return NextResponse.json({
    success: true,
    data: rows.map((r) => ({
      id: r.id,
      caseNumber: r.caseNumber,
      insuredName: r.insuredName,
      status: r.status,
      commissionDate: r.commissionDate.toISOString(),
      departmentName: r.department.name,
    })),
  })
}

// ── PATCH：修正公證編號 ───────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (!assertRole(session.role)) return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const id = Number(body.id)
  const newCaseNumber = String(body.newCaseNumber ?? '').trim()

  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ success: false, error: '案件 id 無效' }, { status: 400 })
  }
  if (!newCaseNumber) {
    return NextResponse.json({ success: false, error: '新公證編號不可為空' }, { status: 400 })
  }

  const target = await prisma.case.findUnique({
    where: { id },
    select: {
      id: true,
      caseNumber: true,
      insuredName: true,
      department: {
        select: { caseNoCode: true, code: true, region: { select: { caseNoCode: true } } },
      },
    },
  })
  if (!target) return NextResponse.json({ success: false, error: '找不到案件' }, { status: 404 })

  const oldCaseNumber = target.caseNumber
  if (newCaseNumber === oldCaseNumber) {
    return NextResponse.json({ success: false, error: '新公證編號與現有相同，無需修正' }, { status: 400 })
  }

  // 唯一性檢查：新號不可與其他案件重複
  const dup = await prisma.case.findFirst({
    where: { caseNumber: newCaseNumber, id: { not: id } },
    select: { id: true },
  })
  if (dup) {
    return NextResponse.json(
      { success: false, error: `公證編號「${newCaseNumber}」已存在於其他案件，請確認` },
      { status: 409 },
    )
  }

  const empId = parseInt(session.sub)
  const caseNoCode = target.department.caseNoCode || target.department.code
  const regionCode = target.department.region.caseNoCode ?? ''

  // [2026/08/04] - Lisa - FR-108 同群組流水號重複警示（警示＋二次確認，不硬擋）。
  // 與建案人工填號同一漏洞：unique 只管完整字串，改成他保司的同序號可造出群組重號。
  const seqConflicts = await findSeqConflicts(prisma, newCaseNumber, caseNoCode, id)
  if (seqConflicts.length > 0 && body.confirmDuplicateSeq !== true) {
    const parts = parseSeqParts(newCaseNumber)
    return NextResponse.json(
      {
        success: false,
        error: `流水號 ${parts?.seq ?? ''} 在「${caseNoCode}${parts?.regionCode ?? ''}-${parts?.year ?? ''}」群組已被使用：${seqConflicts.join('、')}。同部門同年度流水號原則上不重複，確定仍要改為「${newCaseNumber}」？`,
        code: 'DUPLICATE_SEQ',
      },
      { status: 409 },
    )
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1) 更新案件公證編號
      await tx.case.update({ where: { id }, data: { caseNumber: newCaseNumber } })

      // 2) 同步 MailLog 去正規化快照（該案件既有發信紀錄一併改為新號）
      const mailLogUpdated = await tx.mailLog.updateMany({
        where: { caseId: id },
        data: { caseNumber: newCaseNumber },
      })

      // 3) 寫入 CaseLog 稽核軌跡
      await tx.caseLog.create({
        data: {
          caseId: id,
          employeeId: empId,
          fieldName: '公證編號',
          oldValue: oldCaseNumber,
          newValue: newCaseNumber,
          logType: 'case_number_fix',
        },
      })

      // 4) 重算受影響 seqKey（舊號群組 + 新號群組）→ 各自實際最大流水號 + 1
      //    以案件當前部門／區域推導 seqKey，year 由新舊編號中段解析；去重後逐一重算。
      const seqInfos = [
        deriveSeqKey(oldCaseNumber, caseNoCode, regionCode),
        deriveSeqKey(newCaseNumber, caseNoCode, regionCode),
      ].filter((x): x is { seqKey: string; year: string } => x !== null)

      const seen = new Set<string>()
      const recomputed: { seqKey: string; nextSeq: number }[] = []
      for (const info of seqInfos) {
        if (seen.has(info.seqKey)) continue
        seen.add(info.seqKey)
        recomputed.push(await recomputeSeq(tx, info.seqKey, caseNoCode, regionCode, info.year))
      }

      return { mailLogUpdated: mailLogUpdated.count, recomputed }
    })

    return NextResponse.json({
      success: true,
      data: {
        id,
        insuredName: target.insuredName,
        oldCaseNumber,
        newCaseNumber,
        mailLogUpdated: result.mailLogUpdated,
        recomputed: result.recomputed,
      },
    })
  } catch (e) {
    console.error('[case-number fix] 修正失敗：', e)
    return NextResponse.json({ success: false, error: '修正失敗，請稍後再試' }, { status: 500 })
  }
}
