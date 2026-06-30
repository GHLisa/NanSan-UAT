import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'nansan-jwt-secret-change-in-production-2026'
)
const COOKIE_NAME = 'nansan_token'
const EXPIRES_IN = '8h'

export interface JWTPayload {
  sub: string        // employee id (string)
  username: string
  name: string
  role: string       // current active role
  roleName: string
  departmentId: number | null
  departmentName: string | null
  teamGroup: string | null
  allRoles: RoleInfo[]
  mustChangePassword?: boolean   // true 時須先改密，middleware 會攔截導向 /change-password
  impersonatedBy?: { id: number; name: string } | null  // sysadmin 代理登入時記錄原管理員，供稽核與「結束代理」
}

export interface RoleInfo {
  role: string
  roleName: string
  departmentId: number | null
  departmentName: string | null
  teamGroup: string | null
  isPrimary: boolean
}

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(JWT_SECRET)
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as JWTPayload
  } catch {
    return null
  }
}

export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}

export async function getSessionFromRequest(req: NextRequest): Promise<JWTPayload | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyToken(token)
}

export function setCookieHeader(token: string): string {
  const maxAge = 8 * 60 * 60 // 8 hours in seconds
  return `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`
}

export function clearCookieHeader(): string {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`
}

export const ROLES = {
  HANDLER: 'handler',
  TEAM_LEAD: 'team_lead',
  DEPT_MANAGER: 'dept_manager',
  VP: 'vp',
  ADMIN_STAFF: 'admin_staff',
  SYSADMIN: 'sysadmin',
} as const

export type Role = (typeof ROLES)[keyof typeof ROLES]

export function hasRole(session: JWTPayload, ...roles: Role[]): boolean {
  return roles.includes(session.role as Role)
}

export function canViewAllDepts(role: string): boolean {
  return role === 'vp' || role === 'sysadmin'
}
