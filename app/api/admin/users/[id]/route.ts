import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

const UpdateEmployeeSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
})

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const id = parseInt(params.id)
  const body = UpdateEmployeeSchema.parse(await req.json())

  const updateData: Record<string, unknown> = {}
  if (body.name !== undefined) updateData.name = body.name
  if (body.email !== undefined) updateData.email = body.email
  if (body.isActive !== undefined) updateData.isActive = body.isActive
  if (body.password) updateData.password = await bcrypt.hash(body.password, 10)

  const updated = await prisma.employee.update({ where: { id }, data: updateData })

  return NextResponse.json({ success: true, data: { id: updated.id, name: updated.name } })
}

const RolePatchSchema = z.object({
  action: z.enum(['add', 'remove']),
  roleId: z.number().optional(),
  role: z.string().optional(),
  roleName: z.string().optional(),
  departmentId: z.number().nullable().optional(),
  teamGroup: z.string().nullable().optional(),
  isPrimary: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const id = parseInt(params.id)
  const body = RolePatchSchema.parse(await req.json())

  if (body.action === 'remove' && body.roleId) {
    await prisma.employeeRole.delete({ where: { id: body.roleId } })
    return NextResponse.json({ success: true })
  }

  if (body.action === 'add' && body.role && body.roleName) {
    const newRole = await prisma.employeeRole.create({
      data: {
        employeeId: id,
        role: body.role,
        roleName: body.roleName,
        departmentId: body.departmentId ?? null,
        teamGroup: body.teamGroup ?? null,
        isPrimary: body.isPrimary ?? false,
      },
    })
    return NextResponse.json({ success: true, data: { id: newRole.id } })
  }

  return NextResponse.json({ success: false, error: '參數錯誤' }, { status: 400 })
}
