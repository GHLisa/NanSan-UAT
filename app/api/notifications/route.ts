import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const unreadOnly = searchParams.get('unreadOnly') === 'true'
  const action = searchParams.get('action')

  // Handle read-all action via query param
  if (action === 'read-all') {
    const empId = parseInt(session.sub)
    await prisma.notification.updateMany({
      where: {
        isRead: false,
        targetRoles: { contains: session.role },
      },
      data: { isRead: true, readById: empId },
    })
    return NextResponse.json({ success: true })
  }

  const where: Record<string, unknown> = {
    targetRoles: { contains: session.role },
  }
  if (unreadOnly) where.isRead = false

  const notifications = await prisma.notification.findMany({
    where,
    include: {
      case: { select: { caseNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({
    success: true,
    data: notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      caseId: n.caseId,
      caseNumber: n.case?.caseNumber ?? null,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    })),
  })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const empId = parseInt(session.sub)
  const body = await req.json() as { ids?: number[] }

  if (body.ids && body.ids.length > 0) {
    await prisma.notification.updateMany({
      where: { id: { in: body.ids } },
      data: { isRead: true, readById: empId },
    })
  } else {
    await prisma.notification.updateMany({
      where: {
        isRead: false,
        targetRoles: { contains: session.role },
      },
      data: { isRead: true, readById: empId },
    })
  }

  return NextResponse.json({ success: true })
}
