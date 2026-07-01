import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

const ROLE_LABELS: Record<string, string> = {
  handler: '承辦人', team_lead: '組長', dept_manager: '部門主管',
  vp: '執行副總', admin_staff: '行政人員', sysadmin: '系統管理員',
}
const TEAM_GROUP_ROLES = ['handler', 'team_lead']

interface RoleInput { role: string; departmentId: number | null; teamGroup: string | null }

// FR-29/75 角色驗證：
//  (b) handler/team_lead 必填 teamGroup
//  (a) 角色+部門+組別組合不可重複
// 回傳錯誤訊息字串，無誤回傳 null。
function validateRoles(primaryRole: RoleInput | undefined, additionalRoles: RoleInput[]): string | null {
  const all: RoleInput[] = []
  if (primaryRole?.role) all.push(primaryRole)
  for (const ar of additionalRoles) if (ar.role) all.push(ar)

  const seen = new Set<string>()
  for (const r of all) {
    const tg = TEAM_GROUP_ROLES.includes(r.role) ? (r.teamGroup ?? null) : null
    if (TEAM_GROUP_ROLES.includes(r.role) && !tg) {
      return '承辦人與組長需指定組別'
    }
    const key = `${r.role}|${r.departmentId ?? null}|${tg}`
    if (seen.has(key)) return '角色／部門／組別組合重複'
    seen.add(key)
  }
  return null
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin' && session.role !== 'admin_staff') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  // [2026/07/01] - Lisa - 對非 sysadmin 隱藏「純系統管理員」帳號（角色僅有 sysadmin 者）；
  // 同時具 sysadmin＋其他角色仍顯示；sysadmin 本人可見全部
  const employees = await prisma.employee.findMany({
    where: session.role === 'sysadmin' ? {} : {
      NOT: {
        AND: [
          { roles: { some: { role: 'sysadmin' } } },
          { roles: { none: { role: { not: 'sysadmin' } } } },
        ],
      },
    },
    include: { roles: { include: { department: { select: { name: true } } }, orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }] } },
    orderBy: { id: 'asc' },
  })

  return NextResponse.json({
    success: true,
    data: employees.map((e) => ({
      id: e.id, name: e.name, username: e.username, email: e.email, isActive: e.isActive,
      lockedUntil: e.lockedUntil && e.lockedUntil > new Date() ? e.lockedUntil : null,
      roles: e.roles.map((r) => ({
        id: r.id, role: r.role, roleName: r.roleName,
        departmentId: r.departmentId, departmentName: r.department?.name ?? null,
        teamGroup: r.teamGroup, isPrimary: r.isPrimary,
      })),
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin' && session.role !== 'admin_staff') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const body = await req.json() as {
    name: string; username: string; email?: string; isActive?: boolean
    primaryRole?: RoleInput; additionalRoles?: RoleInput[]
  }

  // [2026/07/01] - Lisa - 行政人員不可指派系統管理員角色
  if (session.role === 'admin_staff' &&
      (body.primaryRole?.role === 'sysadmin' || (body.additionalRoles ?? []).some((r) => r.role === 'sysadmin'))) {
    return NextResponse.json({ success: false, error: '行政人員不可指派系統管理員角色' }, { status: 403 })
  }

  if (!body.name || !body.username) {
    return NextResponse.json({ success: false, error: '姓名與帳號必填' }, { status: 400 })
  }

  const existing = await prisma.employee.findUnique({ where: { username: body.username } })
  if (existing) return NextResponse.json({ success: false, error: '帳號已存在' }, { status: 400 })

  // FR-29/75 角色驗證
  const roleError = validateRoles(body.primaryRole, body.additionalRoles ?? [])
  if (roleError) {
    const status = roleError.includes('重複') ? 409 : 400
    return NextResponse.json({ success: false, error: roleError }, { status })
  }

  const hashed = await bcrypt.hash('nansan1234', 10)

  const employee = await prisma.$transaction(async (tx) => {
    const emp = await tx.employee.create({
      data: { name: body.name, username: body.username, password: hashed, email: body.email, isActive: body.isActive ?? true },
    })

    // 主要身分
    if (body.primaryRole?.role) {
      const pr = body.primaryRole
      await tx.employeeRole.create({
        data: {
          employeeId: emp.id, role: pr.role, roleName: ROLE_LABELS[pr.role] ?? pr.role,
          departmentId: pr.departmentId ?? null,
          teamGroup: TEAM_GROUP_ROLES.includes(pr.role) ? (pr.teamGroup ?? null) : null,
          isPrimary: true,
        },
      })
    }

    // 附加身分
    for (const ar of body.additionalRoles ?? []) {
      if (!ar.role) continue
      await tx.employeeRole.create({
        data: {
          employeeId: emp.id, role: ar.role, roleName: ROLE_LABELS[ar.role] ?? ar.role,
          departmentId: ar.departmentId ?? null,
          teamGroup: TEAM_GROUP_ROLES.includes(ar.role) ? (ar.teamGroup ?? null) : null,
          isPrimary: false,
        },
      })
    }

    return emp
  })

  return NextResponse.json({ success: true, data: { id: employee.id } }, { status: 201 })
}
