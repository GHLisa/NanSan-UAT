import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import bcrypt from 'bcryptjs'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const employees = await prisma.employee.findMany({
    include: {
      roles: {
        include: { department: { select: { name: true } } },
      },
    },
    orderBy: { id: 'asc' },
  })

  return NextResponse.json({
    success: true,
    data: employees.map((e) => ({
      id: e.id,
      name: e.name,
      username: e.username,
      email: e.email,
      isActive: e.isActive,
      roles: e.roles.map((r) => ({
        id: r.id,
        role: r.role,
        roleName: r.roleName,
        departmentId: r.departmentId,
        departmentName: r.department?.name ?? null,
        teamGroup: r.teamGroup,
        isPrimary: r.isPrimary,
      })),
    })),
  })
}

const CreateEmployeeSchema = z.object({
  name: z.string().min(1),
  username: z.string().min(3),
  password: z.string().min(6),
  email: z.string().email().optional(),
  isActive: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const body = CreateEmployeeSchema.parse(await req.json())

  const existing = await prisma.employee.findUnique({ where: { username: body.username } })
  if (existing) return NextResponse.json({ success: false, error: '帳號已存在' }, { status: 400 })

  const hashed = await bcrypt.hash(body.password, 10)

  const employee = await prisma.employee.create({
    data: {
      name: body.name,
      username: body.username,
      password: hashed,
      email: body.email,
      isActive: body.isActive ?? true,
    },
  })

  return NextResponse.json({ success: true, data: { id: employee.id } }, { status: 201 })
}
