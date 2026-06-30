import { NextRequest, NextResponse } from 'next/server'
import { getSession, signToken, setCookieHeader, type JWTPayload } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

// 變更密碼（含「首次登入強制改密」流程）
// 驗證目前密碼正確 → 檢查新密碼規則 → 更新並清除 mustChangePassword → 重簽 token
const MIN_LEN = 8

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  // 代理登入（impersonate）狀態下禁止改密，避免管理員竄改他人密碼
  if (session.impersonatedBy) {
    return NextResponse.json({ success: false, error: '代理登入狀態下無法變更密碼' }, { status: 403 })
  }

  const { currentPassword, newPassword } = (await req.json()) as {
    currentPassword?: string
    newPassword?: string
  }

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ success: false, error: '請填寫目前密碼與新密碼' }, { status: 400 })
  }
  if (newPassword.length < MIN_LEN) {
    return NextResponse.json({ success: false, error: `新密碼長度至少 ${MIN_LEN} 碼` }, { status: 400 })
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ success: false, error: '新密碼不可與目前密碼相同' }, { status: 400 })
  }
  if (newPassword === 'nansan1234') {
    return NextResponse.json({ success: false, error: '不可使用預設密碼，請另設新密碼' }, { status: 400 })
  }

  const employee = await prisma.employee.findUnique({ where: { id: Number(session.sub) } })
  if (!employee) return NextResponse.json({ success: false, error: '帳號不存在' }, { status: 404 })

  const valid = await bcrypt.compare(currentPassword, employee.password)
  if (!valid) {
    return NextResponse.json({ success: false, error: '目前密碼不正確' }, { status: 401 })
  }

  const hashed = await bcrypt.hash(newPassword, 10)
  await prisma.employee.update({
    where: { id: employee.id },
    data: { password: hashed, mustChangePassword: false },
  })

  // 重簽 token，清除 mustChangePassword 旗標
  const payload: JWTPayload = { ...session, mustChangePassword: false }
  const token = await signToken(payload)

  const res = NextResponse.json({ success: true })
  res.headers.set('Set-Cookie', setCookieHeader(token))
  return res
}
