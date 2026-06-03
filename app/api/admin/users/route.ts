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

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const employees = await prisma.employee.findMany({
    include: { roles: { include: { department: { select: { name: true } } }, orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }] } },
    orderBy: { id: 'asc' },
  })

  return NextResponse.json({
    success: true,
    data: employees.map((e) => ({
      id: e.id, name: e.name, username: e.username, email: e.email, isActive: e.isActive,
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
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const body = await req.json() as {
    name: string; username: string; email?: string; isActive?: boolean
    primaryRole?: RoleInput; additionalRoles?: RoleInput[]
  }

  if (!body.name || !body.username) {
    return NextResponse.json({ success: false, error: '姓名與帳號必填' }, { status: 400 })
  }

  const existing = await prisma.employee.findUnique({ where: { username: body.username } })
  if (existing) return NextResponse.json({ success: false, error: '帳號已存在' }, { status: 400 })

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
