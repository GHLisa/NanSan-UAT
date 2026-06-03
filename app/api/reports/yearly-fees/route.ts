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

  // ── 取得部門 + 員工 ────────────────────────────────────────────────────
  const [departments, employees, employeeRoles] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employee.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employeeRole.findMany({ select: { employeeId: true, departmentId: true } }),
  ])

  const empMap = new Map(employees.map(e => [e.id, e.name]))

  if (!deptId) {
    return NextResponse.json({
      success: true,
      data: {
        rows: [],
        employees: [],
        departments: departments.map(d => ({ id: d.id, name: d.name })),
        deptName: '',
      },
    })
  }

  // ── 角色可見範圍 WHERE ────────────────────────────────────────────────
  const scopeWhere: Record<string, unknown> = { departmentId: deptId }
  if (role === 'handler' || role === 'admin_staff') {
    // handler 只看自己被指派的案件
    scopeWhere.assignments = { some: { employeeId: empId } }
  } else if (!canViewAllDepts(role) && departmentId && departmentId !== deptId) {
    // 其他受限角色查看非所屬部門：無權限
    return NextResponse.json({ success: true, data: { rows: [], employees: [], departments, deptName: '' } })
  }

  // ── 取得案件（含承辦人）────────────────────────────────────────────────
  const cases = await prisma.case.findMany({
    where: scopeWhere,
    select: {
      id: true,
      commissionDate: true,
      status: true,
      actualFee: true,
      estimatedFee: true,
      assignments: { select: { employeeId: true } },
    },
  })

  // ── 該部門員工（依角色限縮）────────────────────────────────────────────
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

  // ── 收集年份（依受任日） ───────────────────────────────────────────────
  const years = Array.from(new Set(cases.map(c => dayjs(c.commissionDate).year()))).sort((a, b) => b - a)

  // ── 建立 pivot rows ────────────────────────────────────────────────────
  const rows = years.map(year => {
    const yearCases = cases.filter(c => dayjs(c.commissionDate).year() === year)
    const closed = yearCases.filter(c => c.status === '已決')
    const open   = yearCases.filter(c => c.status === '未決')

    const row: Record<string, number | string> = {
      year: `${year} 年`,
      _year: year,
      total:     yearCases.length,
      closedCnt: closed.length,
      openCnt:   open.length,
      closedFee: closed.reduce((s, c) => s + (c.actualFee    ?? 0), 0),
      openFee:   open.reduce  ((s, c) => s + (c.estimatedFee ?? 0), 0),
    }

    for (const emp of deptEmployees) {
      row[`e${emp.id}`] = yearCases.filter(c => c.assignments.some(a => a.employeeId === emp.id)).length
    }

    return row
  })

  const deptName = departments.find(d => d.id === deptId)?.name ?? ''

  return NextResponse.json({
    success: true,
    data: {
      rows,
      employees: deptEmployees,
      departments: departments.map(d => ({ id: d.id, name: d.name })),
      deptName,
    },
  })
}
