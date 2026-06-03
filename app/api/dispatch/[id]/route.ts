import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const id = parseInt(params.id)
  const body = await req.json() as { action: 'pickup' | 'return'; draftData?: string }

  const item = await prisma.dispatchQueue.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ success: false, error: '找不到' }, { status: 404 })

  if (body.action === 'pickup') {
    const updated = await prisma.dispatchQueue.update({
      where: { id },
      data: { status: '已取件', pickedBy: parseInt(session.sub), draftData: body.draftData ?? item.draftData },
    })
    return NextResponse.json({ success: true, data: updated })
  }

  if (body.action === 'return') {
    const updated = await prisma.dispatchQueue.update({
      where: { id },
      data: { status: '待取件', pickedBy: null },
    })
    return NextResponse.json({ success: true, data: updated })
  }

  return NextResponse.json({ success: false, error: '無效操作' }, { status: 400 })
}
