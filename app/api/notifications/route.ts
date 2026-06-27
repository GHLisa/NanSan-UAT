import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildNotificationVisibilityWhere } from '@/lib/caseScope'
import type { Prisma } from '@prisma/client'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const unreadOnly = searchParams.get('unreadOnly') === 'true'
  const action = searchParams.get('action')

  // FR-84：通知可視範圍＝指定收件人(本人) 或 角色廣播+可視案件範圍（見 buildNotificationVisibilityWhere）
  const visibilityWhere = await buildNotificationVisibilityWhere(session)

  // Handle read-all action via query param
  if (action === 'read-all') {
    const empId = parseInt(session.sub)
    await prisma.notification.updateMany({
      where: { isRead: false, ...visibilityWhere },
      data: { isRead: true, readById: empId },
    })
    return NextResponse.json({ success: true })
  }

  const where: Prisma.NotificationWhereInput = { ...visibilityWhere }
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
    // 全部標為已讀：限縮在登入者可視通知範圍（FR-84，含指定收件人通知）
    const visibilityWhere = await buildNotificationVisibilityWhere(session)
    await prisma.notification.updateMany({
      where: { isRead: false, ...visibilityWhere },
      data: { isRead: true, readById: empId },
    })
  }

  return NextResponse.json({ success: true })
}
