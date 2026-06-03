import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import dayjs from 'dayjs'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

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
  const scopeWhere: Record<string, unknown> = { departmentId: deptId, status: '未決' }
  if (role === 'handler' || role === 'admin_staff') {
    scopeWhere.assignments = { some: { employeeId: empId } }
  } else if (!canViewAllDepts(role) && departmentId && departmentId !== deptId) {
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
      commissionDate: true,
      estimatedFee: true,
      assignments: { select: { employeeId: true } },
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

  // ── 收集年份（依受任日，降序）────────────────────────────────────────
  const years = Array.from(new Set(openCases.map(c => dayjs(c.commissionDate).year()))).sort((a, b) => b - a)

  // ── 建立 pivot rows ────────────────────────────────────────────────────
  const rows = years.map(year => {
    const yearCases = openCases.filter(c => dayjs(c.commissionDate).year() === year)
    const row: Record<string, number | string> = {
      year: `${year} 年`,
      _year: year,
      rowCnt: 0,
      rowFee: 0,
    }
    for (const emp of deptEmployees) {
      const empCases = yearCases.filter(c => c.assignments.some(a => a.employeeId === emp.id))
      row[`cnt_${emp.id}`] = empCases.length
      row[`fee_${emp.id}`] = empCases.reduce((s, c) => s + (c.estimatedFee ?? 0), 0)
      row.rowCnt = (row.rowCnt as number) + empCases.length
      row.rowFee = (row.rowFee as number) + empCases.reduce((s, c) => s + (c.estimatedFee ?? 0), 0)
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
