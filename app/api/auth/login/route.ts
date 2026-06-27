import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { signToken, setCookieHeader, type JWTPayload, type RoleInfo } from '@/lib/auth'
import bcrypt from 'bcryptjs'

// FR-01 連續登入失敗鎖定（存於 employees.loginFailCount / lockedUntil，serverless 環境亦持久）
const MAX_ATTEMPTS = 5
const LOCK_DURATION_MS = 15 * 60 * 1000 // 15 分鐘

// 取得來源資訊（Vercel 會帶 x-forwarded-for；取首段為原始用戶端 IP）
function clientMeta(req: NextRequest): { ip: string | null; userAgent: string | null } {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  return { ip, userAgent: req.headers.get('user-agent') }
}

// 登入稽核：每次嘗試寫入一筆 LoginLog；best-effort，寫入失敗只記 log 不影響登入流程
async function recordLoginLog(row: {
  employeeId?: number | null
  username: string
  name?: string | null
  status: 'success' | 'fail' | 'locked'
  reason?: string | null
  ip: string | null
  userAgent: string | null
}): Promise<void> {
  try {
    await prisma.loginLog.create({
      data: {
        employeeId: row.employeeId ?? null,
        username: row.username,
        name: row.name ?? null,
        status: row.status,
        reason: row.reason ?? null,
        ip: row.ip,
        userAgent: row.userAgent,
      },
    })
  } catch (e) {
    console.error('[auth/login] 寫入 LoginLog 失敗（不影響登入）', e)
  }
}

export async function POST(req: NextRequest) {
  const meta = clientMeta(req)
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

    // 帳號不存在/停用 與 密碼錯誤 統一回應，避免揭露帳號是否存在
    if (!employee || !employee.isActive) {
      await recordLoginLog({ username, status: 'fail', reason: '帳號不存在或已停用', ...meta })
      return NextResponse.json({ success: false, error: '帳號或密碼不正確' }, { status: 401 })
    }

    // 檢查鎖定狀態（鎖定中即使密碼正確也拒絕）
    const now = new Date()
    if (employee.lockedUntil && employee.lockedUntil > now) {
      await recordLoginLog({ employeeId: employee.id, username, name: employee.name, status: 'locked', reason: '帳號鎖定中', ...meta })
      return NextResponse.json(
        { success: false, error: '登入失敗次數過多，帳號已鎖定，請 15 分鐘後再試' },
        { status: 429 }
      )
    }

    const valid = await bcrypt.compare(password, employee.password)
    if (!valid) {
      // 鎖定已過期則重新起算；達門檻設定鎖定到期時間
      const lockExpired = employee.lockedUntil && employee.lockedUntil <= now
      const failCount = lockExpired ? 1 : employee.loginFailCount + 1
      const willLock = failCount >= MAX_ATTEMPTS
      await prisma.employee.update({
        where: { id: employee.id },
        data: {
          loginFailCount: failCount,
          lockedUntil: willLock ? new Date(now.getTime() + LOCK_DURATION_MS) : null,
        },
      })
      await recordLoginLog({
        employeeId: employee.id, username, name: employee.name, status: 'fail',
        reason: willLock ? `密碼錯誤（第 ${failCount} 次，帳號已鎖定）` : `密碼錯誤（第 ${failCount} 次）`,
        ...meta,
      })
      return NextResponse.json({ success: false, error: '帳號或密碼不正確' }, { status: 401 })
    }

    // 成功登入：清除失敗記錄
    if (employee.loginFailCount > 0 || employee.lockedUntil) {
      await prisma.employee.update({
        where: { id: employee.id },
        data: { loginFailCount: 0, lockedUntil: null },
      })
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

    await recordLoginLog({ employeeId: employee.id, username, name: employee.name, status: 'success', ...meta })

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
