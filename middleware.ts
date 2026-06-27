import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'nansan-jwt-secret-change-in-production-2026'
)

// /api/cron/* 由 Vercel Cron 觸發（無登入 cookie），授權改由各 cron route 內以 CRON_SECRET 把關
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/cron']

// 頁面級角色守衛：直接輸入 URL 也須符合角色（選單可見性之外的第二道防線）
// /admin/fee-rates 為全角色可見（唯讀），寫入權限由 API 層把關，不在此限制
const ROLE_GUARDED_ROUTES: { prefix: string; roles: string[] }[] = [
  { prefix: '/admin/users',       roles: ['sysadmin'] },
  { prefix: '/admin/master-data', roles: ['sysadmin'] },
  { prefix: '/admin/login-logs',  roles: ['sysadmin'] },
  { prefix: '/performance',       roles: ['team_lead', 'dept_manager'] },
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // Allow Next.js internals
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next()
  }

  const token = req.cookies.get('nansan_token')?.value

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', req.url))
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)

    // 角色守衛（P-04）：非授權角色導回儀表板
    const guard = ROLE_GUARDED_ROUTES.find((g) => pathname.startsWith(g.prefix))
    if (guard) {
      const role = payload.role as string | undefined
      if (!role || !guard.roles.includes(role)) {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
        }
        return NextResponse.redirect(new URL('/dashboard', req.url))
      }
    }

    return NextResponse.next()
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ success: false, error: 'Token 已過期' }, { status: 401 })
    }
    const res = NextResponse.redirect(new URL('/login', req.url))
    res.cookies.delete('nansan_token')
    return res
  }
}

export const config = {
  // [效能] 排除 Next 內部與靜態資源，避免對非受保護資源重複執行 middleware（jwtVerify）。
  // 頁面導航、RSC 與 /api 仍會通過驗證。
  matcher: ['/((?!_next/static|_next/image|_next/data|favicon.ico|icon.svg).*)'],
}
