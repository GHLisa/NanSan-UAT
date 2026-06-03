import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signToken, setCookieHeader, type JWTPayload, type RoleInfo } from '@/lib/auth'
import bcrypt from 'bcryptjs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { username, password } = body as { username: string; password: string }

    if (!username || !password) {
      return NextResponse.json({ success: false, error: '請填寫帳號與密碼' }, { status: 400 })
    }

    const employee = await prisma.employee.findUnique({
      where: { username },
      include: {
        roles: {
          include: { department: true },
          orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
        },
      },
    })

    if (!employee || !employee.isActive) {
      return NextResponse.json({ success: false, error: '帳號不存在或已停用' }, { status: 401 })
    }

    const valid = await bcrypt.compare(password, employee.password)
    if (!valid) {
      return NextResponse.json({ success: false, error: '密碼錯誤' }, { status: 401 })
    }

    const allRoles: RoleInfo[] = employee.roles.map((r) => ({
      role: r.role,
      roleName: r.roleName,
      departmentId: r.departmentId,
      departmentName: r.department?.name ?? null,
      teamGroup: r.teamGroup,
      isPrimary: r.isPrimary,
    }))

    const primaryRole = allRoles.find((r) => r.isPrimary) ?? allRoles[0]

    const payload: JWTPayload = {
      sub: String(employee.id),
      username: employee.username,
      name: employee.name,
      role: primaryRole.role,
      roleName: primaryRole.roleName,
      departmentId: primaryRole.departmentId,
      departmentName: primaryRole.departmentName,
      teamGroup: primaryRole.teamGroup,
      allRoles,
    }

    const token = await signToken(payload)

    const res = NextResponse.json({
      success: true,
      data: {
        id: employee.id,
        name: employee.name,
        username: employee.username,
        role: primaryRole.role,
        roleName: primaryRole.roleName,
        departmentId: primaryRole.departmentId,
        departmentName: primaryRole.departmentName,
        teamGroup: primaryRole.teamGroup,
        allRoles,
        requiresRoleSelect: allRoles.length > 1,
      },
    })
    res.headers.set('Set-Cookie', setCookieHeader(token))
    return res
  } catch (e) {
    console.error('[auth/login]', e)
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 })
  }
}
