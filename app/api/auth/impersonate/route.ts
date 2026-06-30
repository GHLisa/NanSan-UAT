import { NextRequest, NextResponse } from 'next/server'
import { getSession, signToken, setCookieHeader, type JWTPayload, type RoleInfo } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// 代理登入（impersonate）— 僅 sysadmin
//   POST   ：以指定員工身分登入，token 內記錄 impersonatedBy（原管理員）供稽核與「結束代理」
//   DELETE ：結束代理，還原為原管理員身分
// 註：本路由置於 /api/auth/* 而非 /admin/*，因代理後角色已非 sysadmin，
//     若放 /admin 會被 middleware 角色守衛擋住而無法結束代理。

type EmployeeWithRoles = {
  id: number
  username: string
  name: string
  isActive: boolean
  mustChangePassword: boolean
  roles: {
    role: string
    roleName: string
    departmentId: number | null
    teamGroup: string | null
    isPrimary: boolean
    department: { name: string } | null
  }[]
}

function buildPayload(emp: EmployeeWithRoles, impersonatedBy: { id: number; name: string } | null): JWTPayload {
  const allRoles: RoleInfo[] = emp.roles.map((r) => ({
    role: r.role,
    roleName: r.roleName,
    departmentId: r.departmentId,
    departmentName: r.department?.name ?? null,
    teamGroup: r.teamGroup,
    isPrimary: r.isPrimary,
  }))
  const primary = allRoles.find((r) => r.isPrimary) ?? allRoles[0]
  return {
    sub: String(emp.id),
    username: emp.username,
    name: emp.name,
    role: primary.role,
    roleName: primary.roleName,
    departmentId: primary.departmentId,
    departmentName: primary.departmentName,
    teamGroup: primary.teamGroup,
    allRoles,
    // 代理登入期間不強制改密（管理員僅檢視，且不應代他人改密）
    mustChangePassword: impersonatedBy ? false : emp.mustChangePassword,
    impersonatedBy,
  }
}

const ROLE_INCLUDE = {
  roles: {
    include: { department: { select: { name: true } } },
    orderBy: [{ isPrimary: 'desc' as const }, { id: 'asc' as const }],
  },
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin' || session.impersonatedBy) {
    return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
  }

  const { employeeId } = (await req.json()) as { employeeId?: number }
  if (!employeeId) return NextResponse.json({ success: false, error: '缺少 employeeId' }, { status: 400 })

  const target = await prisma.employee.findUnique({ where: { id: employeeId }, include: ROLE_INCLUDE })
  if (!target || !target.isActive) {
    return NextResponse.json({ success: false, error: '目標帳號不存在或已停用' }, { status: 404 })
  }
  if (target.id === Number(session.sub)) {
    return NextResponse.json({ success: false, error: '不可代理登入自己' }, { status: 400 })
  }

  const admin = { id: Number(session.sub), name: session.name }
  const payload = buildPayload(target as EmployeeWithRoles, admin)
  const token = await signToken(payload)

  // 稽核：記錄代理登入
  await prisma.loginLog.create({
    data: {
      employeeId: target.id, username: target.username, name: target.name,
      status: 'success', reason: `代理登入（by ${admin.name} #${admin.id}）`,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: req.headers.get('user-agent'),
    },
  }).catch((e) => console.error('[impersonate] LoginLog 寫入失敗', e))

  const res = NextResponse.json({ success: true, data: { name: target.name, role: payload.role, roleName: payload.roleName } })
  res.headers.set('Set-Cookie', setCookieHeader(token))
  return res
}

export async function DELETE() {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (!session.impersonatedBy) {
    return NextResponse.json({ success: false, error: '目前非代理登入狀態' }, { status: 400 })
  }

  const admin = await prisma.employee.findUnique({ where: { id: session.impersonatedBy.id }, include: ROLE_INCLUDE })
  if (!admin) return NextResponse.json({ success: false, error: '原管理員帳號不存在' }, { status: 404 })

  const payload = buildPayload(admin as EmployeeWithRoles, null)
  const token = await signToken(payload)

  const res = NextResponse.json({ success: true, data: { name: admin.name } })
  res.headers.set('Set-Cookie', setCookieHeader(token))
  return res
}
