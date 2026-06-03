import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const year = parseInt(req.nextUrl.searchParams.get('year') ?? String(new Date().getFullYear()))

  const deptFilter = session.role === 'vp' || session.role === 'sysadmin' || !session.departmentId
    ? {}
    : { employee: { roles: { some: { departmentId: session.departmentId } } } }

  const targets = await prisma.feeTarget.findMany({
    where: { year, ...deptFilter },
    include: {
      employee: { select: { name: true } },
      setter: { select: { name: true } },
    },
    orderBy: { employee: { name: 'asc' } },
  })

  return NextResponse.json({
    success: true,
    data: targets.map((t) => ({
      id: t.id,
      employeeId: t.employeeId,
      employeeName: t.employee.name,
      year: t.year,
      targetAmount: t.targetAmount,
      targetCaseCount: t.targetCaseCount,
      setByName: t.setter.name,
      setAt: t.setAt.toISOString(),
    })),
  })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { employeeId, year, targetAmount, targetCaseCount } = await req.json() as {
    employeeId: number; year: number; targetAmount: number; targetCaseCount: number
  }

  const target = await prisma.feeTarget.upsert({
    where: { employeeId_year: { employeeId, year } },
    create: {
      employeeId, year, targetAmount, targetCaseCount,
      setBy: parseInt(session.sub), setAt: new Date(),
    },
    update: {
      targetAmount, targetCaseCount,
      setBy: parseInt(session.sub), setAt: new Date(),
    },
  })

  return NextResponse.json({ success: true, data: target })
}
