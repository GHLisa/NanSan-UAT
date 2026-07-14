import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { caseReportYear } from '@/lib/caseYear'

// [2026/07/02] - Lisa - 開放行政人員查看：各員工未決件數&預估公證費（全公司範圍）
const ALLOWED_ROLES = ['team_lead', 'dept_manager', 'vp', 'sysadmin', 'admin_staff']

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const deptId = searchParams.get('deptId') ? parseInt(searchParams.get('deptId')!) : null
  const empId = parseInt(session.sub)
  const { role, departmentId } = session

  // ── 取得部門 + 員工角色關聯 ──────────────────────────────────────────
  const [departments, employees, employeeRoles] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employee.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employeeRole.findMany({ select: { employeeId: true, departmentId: true } }),
  ])

  const empMap = new Map(employees.map(e => [e.id, e.name]))

  if (!deptId) {
    return NextResponse.json({
      success: true,
      data: { rows: [], employees: [], departments: departments.map(d => ({ id: d.id, name: d.name })), deptName: '' },
    })
  }

  // ── 角色可見範圍 WHERE（只看未決）─────────────────────────────────────
  // [2026/07/02] - Lisa - 行政人員比照 vp/sysadmin 視為全公司範圍（可查任一部門）
  const isWideRole = canViewAllDepts(role) || role === 'admin_staff'
  const scopeWhere: Record<string, unknown> = { departmentId: deptId, status: '未決' }
  if (role === 'handler') {
    scopeWhere.assignments = { some: { employeeId: empId } }
  } else if (!isWideRole && departmentId && departmentId !== deptId) {
    return NextResponse.json({
      success: true,
      data: { rows: [], employees: [], departments: departments.map(d => ({ id: d.id, name: d.name })), deptName: '' },
    })
  }

  // ── 取得未決案件（含承辦人）─────────────────────────────────────────
  const openCases = await prisma.case.findMany({
    where: scopeWhere,
    select: {
      id: true,
      caseNumber: true,
      commissionDate: true,
      estimatedFee: true,
      assignments: { select: { employeeId: true, role: true, contributionRatio: true } },
    },
  })

  // ── 該部門員工（依角色限縮）──────────────────────────────────────────
  const deptEmpIds = Array.from(new Set(employeeRoles.filter(r => r.departmentId === deptId).map(r => r.employeeId)))
  let deptEmployees: { id: number; name: string }[]
  if (role === 'handler') {
    deptEmployees = [{ id: empId, name: empMap.get(empId) ?? '本人' }]
  } else {
    deptEmployees = deptEmpIds
      .filter(id => empMap.has(id))
      .map(id => ({ id, name: empMap.get(id)! }))
      .sort((a, b) => a.id - b.id)
  }

  // ── 收集年份（以公證編號年度為準，無法解析時回退委託日期年度，降序）──────
  const years = Array.from(new Set(openCases.map(c => caseReportYear(c.caseNumber, c.commissionDate)))).sort((a, b) => b - a)

  // ── 建立 pivot rows ────────────────────────────────────────────────────
  const rows = years.map(year => {
    const yearCases = openCases.filter(c => caseReportYear(c.caseNumber, c.commissionDate) === year)
    const row: Record<string, number | string> = {
      year: `${year} 年`,
      _year: year,
      rowCnt: 0,
      rowFee: 0,
    }
    for (const emp of deptEmployees) {
      // [2026/07/14] - Lisa - 未決件數只計主辦；預估公證費依承辦比例分攤（主辦＋協辦各按其比例）
      const cnt = yearCases.filter(c => c.assignments.some(a => a.employeeId === emp.id && a.role === '主辦')).length
      const fee = yearCases.reduce((s, c) => {
        const a = c.assignments.find(x => x.employeeId === emp.id)
        return s + (a ? Math.round((c.estimatedFee ?? 0) * a.contributionRatio) : 0)
      }, 0)
      row[`cnt_${emp.id}`] = cnt
      row[`fee_${emp.id}`] = fee
      row.rowCnt = (row.rowCnt as number) + cnt
      row.rowFee = (row.rowFee as number) + fee
    }
    return row
  })

  // ── 計算欄位合計 ──────────────────────────────────────────────────────
  const totals: Record<string, number> = { grandCnt: 0, grandFee: 0 }
  for (const emp of deptEmployees) {
    totals[`cnt_${emp.id}`] = rows.reduce((s, r) => s + ((r[`cnt_${emp.id}`] as number) || 0), 0)
    totals[`fee_${emp.id}`] = rows.reduce((s, r) => s + ((r[`fee_${emp.id}`] as number) || 0), 0)
    totals.grandCnt += totals[`cnt_${emp.id}`]
    totals.grandFee += totals[`fee_${emp.id}`]
  }

  const deptName = departments.find(d => d.id === deptId)?.name ?? ''

  return NextResponse.json({
    success: true,
    data: {
      rows,
      employees: deptEmployees,
      totals,
      departments: departments.map(d => ({ id: d.id, name: d.name })),
      deptName,
    },
  })
}
