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

// PUT: update employee info + full role replacement
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const id = parseInt(params.id)
  const body = await req.json() as {
    name?: string; email?: string | null; isActive?: boolean; password?: string
    unlock?: boolean; resetPassword?: boolean
    primaryRole?: RoleInput; additionalRoles?: RoleInput[]
  }

  // FR-29/75 角色驗證（僅在有提供角色時）
  if (body.primaryRole) {
    const roleError = validateRoles(body.primaryRole, body.additionalRoles ?? [])
    if (roleError) {
      const status = roleError.includes('重複') ? 409 : 400
      return NextResponse.json({ success: false, error: roleError }, { status })
    }
  }

  await prisma.$transaction(async (tx) => {
    // Update basic info
    const updateData: Record<string, unknown> = {}
    if (body.name !== undefined) updateData.name = body.name
    if (body.email !== undefined) updateData.email = body.email
    if (body.isActive !== undefined) updateData.isActive = body.isActive
    if (body.password) updateData.password = await bcrypt.hash(body.password, 10)
    // 管理員重設密碼：回復預設密碼 nansan1234，並強制使用者下次登入改密；同時解除登入鎖定
    if (body.resetPassword) {
      updateData.password = await bcrypt.hash('nansan1234', 10)
      updateData.mustChangePassword = true
      updateData.loginFailCount = 0
      updateData.lockedUntil = null
    }
    // FR-01 解鎖：清除登入失敗計數與鎖定時間
    if (body.unlock) {
      updateData.loginFailCount = 0
      updateData.lockedUntil = null
    }
    if (Object.keys(updateData).length > 0) {
      await tx.employee.update({ where: { id }, data: updateData })
    }

    // Replace roles if provided：整批刪除後重建，確保 isPrimary 僅一筆
    if (body.primaryRole) {
      const pr = body.primaryRole
      await tx.employeeRole.deleteMany({ where: { employeeId: id } })

      await tx.employeeRole.create({
        data: {
          employeeId: id, role: pr.role, roleName: ROLE_LABELS[pr.role] ?? pr.role,
          departmentId: pr.departmentId ?? null,
          teamGroup: TEAM_GROUP_ROLES.includes(pr.role) ? (pr.teamGroup ?? null) : null,
          isPrimary: true,
        },
      })

      for (const ar of body.additionalRoles ?? []) {
        if (!ar.role) continue
        await tx.employeeRole.create({
          data: {
            employeeId: id, role: ar.role, roleName: ROLE_LABELS[ar.role] ?? ar.role,
            departmentId: ar.departmentId ?? null,
            teamGroup: TEAM_GROUP_ROLES.includes(ar.role) ? (ar.teamGroup ?? null) : null,
            isPrimary: false,
          },
        })
      }
    }
  })

  return NextResponse.json({ success: true })
}

// PATCH: simple role add/remove (kept for backward compatibility)
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const id = parseInt(params.id)
  const body = await req.json() as { action: string; roleId?: number; role?: string; roleName?: string; departmentId?: number | null; teamGroup?: string | null; isPrimary?: boolean }

  if (body.action === 'remove' && body.roleId) {
    await prisma.employeeRole.delete({ where: { id: body.roleId } })
    return NextResponse.json({ success: true })
  }

  if (body.action === 'add' && body.role) {
    const newRole = await prisma.employeeRole.create({
      data: {
        employeeId: id, role: body.role, roleName: ROLE_LABELS[body.role] ?? body.role,
        departmentId: body.departmentId ?? null,
        teamGroup: body.teamGroup ?? null, isPrimary: body.isPrimary ?? false,
      },
    })
    return NextResponse.json({ success: true, data: { id: newRole.id } })
  }

  return NextResponse.json({ success: false, error: '參數錯誤' }, { status: 400 })
}
