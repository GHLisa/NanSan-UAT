import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import dayjs from 'dayjs'

const WIDE_ROLES = ['vp', 'sysadmin', 'admin_staff']

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()))
  const reqDeptId = searchParams.get('deptId') ? parseInt(searchParams.get('deptId')!) : null

  const empId = parseInt(session.sub)
  const { role, departmentId, teamGroup } = session
  const isWideRole = WIDE_ROLES.includes(role) || canViewAllDepts(role)

  // ── 取得部門 / 員工 / 員工角色關聯 ────────────────────────────────────
  const [departments, employees, employeeRoles] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employee.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employeeRole.findMany({ select: { employeeId: true, departmentId: true, teamGroup: true } }),
  ])

  const empMap = new Map(employees.map(e => [e.id, e.name]))

  // ── 依角色決定可見員工清單（員工績效用）─────────────────────────────
  let scopedEmpIds: Set<number>
  if (isWideRole) {
    scopedEmpIds = new Set(employees.map(e => e.id))
  } else if (role === 'handler') {
    scopedEmpIds = new Set([empId])
  } else if (role === 'team_lead') {
    scopedEmpIds = new Set(
      employeeRoles
        .filter(r => r.departmentId === departmentId && r.teamGroup === teamGroup)
        .map(r => r.employeeId)
    )
  } else {
    // dept_manager
    scopedEmpIds = new Set(
      employeeRoles
        .filter(r => r.departmentId === departmentId)
        .map(r => r.employeeId)
    )
  }

  // ── 依角色決定可見部門（接案件數用）─────────────────────────────────
  // 全域角色：null=全部，可由 reqDeptId 縮放；受限角色：固定本部門
  const scopedDeptId: number | null = isWideRole ? reqDeptId : (departmentId ?? null)

  // ── 取得當年案件（依委託日 commissionDate）─────────────────────────
  const yearStart = new Date(`${year}-01-01`)
  const yearEnd = new Date(`${year + 1}-01-01`)

  const cases = await prisma.case.findMany({
    where: { commissionDate: { gte: yearStart, lt: yearEnd } },
    select: {
      id: true,
      departmentId: true,
      commissionDate: true,
      status: true,
      actualFee: true,
      estimatedFee: true,
      assignments: { select: { employeeId: true } },
    },
  })

  // ── 員工績效 ───────────────────────────────────────────────────────
  // 未決：estimatedFee 加總（預估）；已決：actualFee 加總（實際）
  const perfMap = new Map<number, {
    employeeId: number; name: string
    openCount: number; closedCount: number
    openFee: number; closedFee: number
  }>()

  for (const c of cases) {
    for (const a of c.assignments) {
      if (!scopedEmpIds.has(a.employeeId)) continue
      let row = perfMap.get(a.employeeId)
      if (!row) {
        row = {
          employeeId: a.employeeId,
          name: empMap.get(a.employeeId) ?? '—',
          openCount: 0, closedCount: 0, openFee: 0, closedFee: 0,
        }
        perfMap.set(a.employeeId, row)
      }
      if (c.status === '未決') {
        row.openCount += 1
        row.openFee += c.estimatedFee ?? 0
      } else if (c.status === '已決') {
        row.closedCount += 1
        row.closedFee += c.actualFee ?? 0
      }
    }
  }

  const employeePerformance = Array.from(perfMap.values())
    .sort((a, b) => a.employeeId - b.employeeId)

  // ── 接案件數：部門 × 12 月份交叉表（依委託日）──────────────────────
  const visibleDepts = scopedDeptId
    ? departments.filter(d => d.id === scopedDeptId)
    : departments

  const deptMonthly = visibleDepts.map(dept => {
    const months = new Array(12).fill(0) as number[]
    for (const c of cases) {
      if (c.departmentId !== dept.id) continue
      const m = dayjs(c.commissionDate).month() // 0-11
      months[m] += 1
    }
    const total = months.reduce((s, v) => s + v, 0)
    return { departmentId: dept.id, name: dept.name, months, total }
  })

  return NextResponse.json({
    success: true,
    data: {
      year,
      employeePerformance,
      deptMonthly,
      departments: departments.map(d => ({ id: d.id, name: d.name })),
      isWideRole,
    },
  })
}
