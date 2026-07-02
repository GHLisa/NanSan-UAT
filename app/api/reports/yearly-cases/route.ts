import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import dayjs from 'dayjs'

// [2026/07/02] - Lisa - 開放行政人員查看：各年度已決&未決案件數（全公司範圍）
const ALLOWED_ROLES = ['team_lead', 'dept_manager', 'vp', 'sysadmin', 'admin_staff']

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const deptId = searchParams.get('deptId') ? parseInt(searchParams.get('deptId')!) : null
  const status = searchParams.get('status') ?? 'all'  // 'all' | '已決' | '未決'
  const empId = parseInt(session.sub)
  const { role, departmentId } = session

  // ── 角色可見範圍 WHERE ────────────────────────────────────────────────
  // [2026/07/02] - Lisa - 行政人員比照 vp/sysadmin 視為全公司範圍（不加部門條件）
  const isWideRole = canViewAllDepts(role) || role === 'admin_staff'
  const scopeWhere: Record<string, unknown> = {}
  if (!isWideRole) {
    if (role === 'handler') {
      scopeWhere.assignments = { some: { employeeId: empId } }
    } else if (departmentId) {
      scopeWhere.departmentId = departmentId
    }
  }
  if (status !== 'all') scopeWhere.status = status

  // ── 取得所有可見案件 + 承辦人資料 ────────────────────────────────────
  const cases = await prisma.case.findMany({
    where: scopeWhere,
    select: {
      id: true,
      departmentId: true,
      commissionDate: true,
      status: true,
      assignments: {
        select: { employeeId: true },
      },
    },
  })

  // ── 取得部門 + 員工 ────────────────────────────────────────────────────
  const [departments, employees, employeeRoles] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employee.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employeeRole.findMany({ select: { employeeId: true, departmentId: true, teamGroup: true } }),
  ])

  const empMap = new Map(employees.map(e => [e.id, e.name]))

  // ── TABLE 1: 年度 × 員工（選定部門）────────────────────────────────────
  let tab1: {
    employees: { id: number; name: string }[]
    rows: Record<string, number | string>[]
  } | null = null

  if (deptId) {
    // 該部門員工
    const deptEmpIds = Array.from(new Set(employeeRoles.filter(r => r.departmentId === deptId).map(r => r.employeeId)))
    const deptEmployees = deptEmpIds
      .filter(id => empMap.has(id))
      .map(id => ({ id, name: empMap.get(id)! }))
      .sort((a, b) => a.id - b.id)

    // 該部門的案件
    const deptCases = cases.filter(c => c.departmentId === deptId)

    // 收集年份
    const years = Array.from(new Set(deptCases.map(c => dayjs(c.commissionDate).year()))).sort((a, b) => b - a)

    const rows = years.map(year => {
      const yearCases = deptCases.filter(c => dayjs(c.commissionDate).year() === year)
      const row: Record<string, number | string> = { year: `${year} 年`, _year: year }
      let total = 0
      for (const emp of deptEmployees) {
        const count = yearCases.filter(c => c.assignments.some(a => a.employeeId === emp.id)).length
        row[`e${emp.id}`] = count
        total += count
      }
      row.total = total
      return row
    })

    tab1 = { employees: deptEmployees, rows }
  }

  // ── TABLE 2: 部門 × 員工（累計）───────────────────────────────────────
  // 找出有案件的員工
  const activeCaseEmpIds = new Set(cases.flatMap(c => c.assignments.map(a => a.employeeId)))
  const activeEmployees = employees
    .filter(e => activeCaseEmpIds.has(e.id))
    .sort((a, b) => a.id - b.id)

  const deptRows = departments.map(dept => {
    const deptCaseIds = new Set(cases.filter(c => c.departmentId === dept.id).map(c => c.id))
    const row: Record<string, number | string> = { deptId: dept.id, deptName: dept.name }
    let total = 0
    for (const emp of activeEmployees) {
      const count = cases
        .filter(c => deptCaseIds.has(c.id) && c.assignments.some(a => a.employeeId === emp.id))
        .length
      row[`e${emp.id}`] = count
      total += count
    }
    row.total = total
    return row
  }).filter(r => (r.total as number) > 0)

  return NextResponse.json({
    success: true,
    data: {
      tab1,
      tab2: { employees: activeEmployees, rows: deptRows },
      departments: departments.map(d => ({ id: d.id, name: d.name })),
    },
  })
}
