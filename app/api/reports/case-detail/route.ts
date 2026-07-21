import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { splitFeeByRatio } from '@/lib/feeSplit'
import { prisma } from '@/lib/prisma'
import dayjs from 'dayjs'

const QUARTER_MONTHS: Record<string, number[]> = {
  Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9], Q4: [10,11,12],
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const type    = searchParams.get('type') ?? 'monthly'  // 'monthly' | 'quarterly'
  const year    = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()))
  const month   = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1))
  const quarter = searchParams.get('quarter') ?? 'Q1'
  const deptId  = searchParams.get('deptId') ? parseInt(searchParams.get('deptId')!) : null
  const empId   = parseInt(session.sub)
  const { role, departmentId } = session

  // ── closeDate 範圍 ─────────────────────────────────────────────────────
  let closeDateWhere: { gte: Date; lte: Date }
  if (type === 'monthly') {
    const start = dayjs(`${year}-${String(month).padStart(2,'0')}-01`)
    closeDateWhere = { gte: start.toDate(), lte: start.endOf('month').toDate() }
  } else {
    const months = QUARTER_MONTHS[quarter] ?? [1,2,3]
    const m1 = months[0], m2 = months[months.length - 1]
    closeDateWhere = {
      gte: dayjs(`${year}-${String(m1).padStart(2,'0')}-01`).toDate(),
      lte: dayjs(`${year}-${String(m2).padStart(2,'0')}-01`).endOf('month').toDate(),
    }
  }

  // ── 角色可見範圍 WHERE ─────────────────────────────────────────────────
  const scopeWhere: Record<string, unknown> = {
    status: '已決',
    closeDate: closeDateWhere,
  }
  if (role === 'handler') {
    scopeWhere.assignments = { some: { employeeId: empId } }
    if (departmentId) scopeWhere.departmentId = departmentId
  } else if (canViewAllDepts(role) || role === 'admin_staff') {
    // [2026/07/07] - Lisa - 行政人員比照副總：全公司範圍，可依部門查詢條件篩選
    if (deptId) scopeWhere.departmentId = deptId
  } else if (departmentId) {
    scopeWhere.departmentId = departmentId
  }

  // ── 取得已決案件 ─────────────────────────────────────────────────────────
  const cases = await prisma.case.findMany({
    where: scopeWhere,
    select: {
      id: true,
      caseNumber: true,
      insuredName: true,
      closeDate: true,
      actualFee: true,
      travelOtherExpense: true,
      notes: true,
      assignments: {
        select: {
          employeeId: true,
          role: true,
          contributionRatio: true,
          employee: { select: { name: true } },
        },
      },
    },
    orderBy: { closeDate: 'asc' },
  })

  // ── 依主辦人分組 ──────────────────────────────────────────────────────────
  type CaseRow = {
    id: number; caseNumber: string; insuredName: string
    closeDate: string; actualFee: number; travelFee: number
    subtotalFee: number; remarks: string
  }
  type EmpGroup = { empId: number; empName: string; cases: CaseRow[]; totals: { caseCount: number; actualFee: number; travelFee: number; subtotalFee: number } }

  const empMap = new Map<number, EmpGroup>()

  // [2026/07/14] - Lisa - 純公證費/差旅其他費/小計依承辦比例分配；每位經辦人（主辦＋協辦）各列其份額，同一案分列各人，件數依參與人計
  for (const c of cases) {
    const travelFeeFull = c.travelOtherExpense ?? 0
    const actualFeeFull = c.actualFee ?? 0

    // 備註：多位承辦人時顯示分工比例
    const remarks = c.assignments.length > 1
      ? c.assignments.map(a => `${a.employee.name} ${Math.round((a.contributionRatio ?? 0) * 100)}%`).join('/')
      : ''

    // 純公證費依承辦比例分攤（非主辦捨去、主辦吸收剩餘）
    const feeAmts = splitFeeByRatio(actualFeeFull, c.assignments, x => x.contributionRatio ?? 0, x => x.role === '主辦')
    c.assignments.forEach((a, ai) => {
      const actualFee = feeAmts[ai]
      const travelFee = a.role === '主辦' ? travelFeeFull : 0
      const subtotalFee = actualFee + travelFee

      if (!empMap.has(a.employeeId)) {
        empMap.set(a.employeeId, {
          empId: a.employeeId,
          empName: a.employee.name,
          cases: [],
          totals: { caseCount: 0, actualFee: 0, travelFee: 0, subtotalFee: 0 },
        })
      }
      const group = empMap.get(a.employeeId)!
      group.cases.push({
        id: c.id,
        caseNumber: c.caseNumber,
        insuredName: c.insuredName,
        closeDate: c.closeDate!.toISOString(),
        actualFee,
        travelFee,
        subtotalFee,
        remarks,
      })
      group.totals.caseCount++
      group.totals.actualFee += actualFee
      group.totals.travelFee += travelFee
      group.totals.subtotalFee += subtotalFee
    })
  }

  const groups = Array.from(empMap.values())

  const grandTotals = groups.reduce(
    (s, g) => ({
      caseCount: s.caseCount + g.totals.caseCount,
      actualFee: s.actualFee + g.totals.actualFee,
      travelFee: s.travelFee + g.totals.travelFee,
      subtotalFee: s.subtotalFee + g.totals.subtotalFee,
    }),
    { caseCount: 0, actualFee: 0, travelFee: 0, subtotalFee: 0 }
  )

  // ── 季統計：計算 YTD ─────────────────────────────────────────────────────
  let ytdGroups: EmpGroup[] | null = null
  if (type === 'quarterly') {
    const qMonths = QUARTER_MONTHS[quarter] ?? [1,2,3]
    const ytdEndMonth = qMonths[qMonths.length - 1]
    const ytdEnd = dayjs(`${year}-${String(ytdEndMonth).padStart(2,'0')}-01`).endOf('month')

    const ytdCases = await prisma.case.findMany({
      where: {
        ...scopeWhere,
        closeDate: { gte: new Date(`${year}-01-01`), lte: ytdEnd.toDate() },
      },
      select: {
        id: true,
        caseNumber: true,
        insuredName: true,
        closeDate: true,
        actualFee: true,
        travelOtherExpense: true,
        assignments: {
          select: { employeeId: true, role: true, contributionRatio: true, employee: { select: { name: true } } },
        },
      },
    })

    const ytdMap = new Map<number, EmpGroup>()
    for (const c of ytdCases) {
      const travelFeeFull = c.travelOtherExpense ?? 0
      const actualFeeFull = c.actualFee ?? 0
      const ytdFeeAmts = splitFeeByRatio(actualFeeFull, c.assignments, x => x.contributionRatio ?? 0, x => x.role === '主辦')
      c.assignments.forEach((a, ai) => {
        const actualFee = ytdFeeAmts[ai]
        const travelFee = a.role === '主辦' ? travelFeeFull : 0
        if (!ytdMap.has(a.employeeId)) {
          ytdMap.set(a.employeeId, { empId: a.employeeId, empName: a.employee.name, cases: [], totals: { caseCount: 0, actualFee: 0, travelFee: 0, subtotalFee: 0 } })
        }
        const g = ytdMap.get(a.employeeId)!
        g.totals.caseCount++
        g.totals.actualFee += actualFee
        g.totals.travelFee += travelFee
        g.totals.subtotalFee += actualFee + travelFee
      })
    }
    ytdGroups = Array.from(ytdMap.values())
  }

  return NextResponse.json({
    success: true,
    data: { type, year, month, quarter, groups, grandTotals, ytdGroups },
  })
}
