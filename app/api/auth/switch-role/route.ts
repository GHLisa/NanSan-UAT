import { NextRequest, NextResponse } from 'next/server'
import { getSession, signToken, setCookieHeader, type JWTPayload } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  }

  const { roleIndex } = await req.json() as { roleIndex: number }
  const targetRole = session.allRoles[roleIndex]

  if (!targetRole) {
    return NextResponse.json({ success: false, error: '角色不存在' }, { status: 400 })
  }

  const payload: JWTPayload = {
    ...session,
    role: targetRole.role,
    roleName: targetRole.roleName,
    departmentId: targetRole.departmentId,
    departmentName: targetRole.departmentName,
    teamGroup: targetRole.teamGroup,
  }

  const token = await signToken(payload)
  const res = NextResponse.json({
    success: true,
    data: { role: targetRole.role, roleName: targetRole.roleName, departmentName: targetRole.departmentName },
  })
  res.headers.set('Set-Cookie', setCookieHeader(token))
  return res
}
