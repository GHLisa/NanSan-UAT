import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const id = parseInt(params.id)
  const body = await req.json() as { action: 'pickup' | 'return' | 'draft'; draftData?: string }

  const item = await prisma.dispatchQueue.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ success: false, error: '找不到' }, { status: 404 })

  // FR-79 暫存：只寫入 draftData，status 維持「待取件」、不寫 pickedBy
  if (body.action === 'draft') {
    const updated = await prisma.dispatchQueue.update({
      where: { id },
      data: { draftData: body.draftData ?? null },
    })
    return NextResponse.json({ success: true, data: updated })
  }

  if (body.action === 'pickup') {
    // FR-06 原子鎖定：僅「待取件」可被取走，否則視為已被他人取走
    const locked = await prisma.dispatchQueue.updateMany({
      where: { id, status: '待取件' },
      data: { status: '已取件', pickedBy: parseInt(session.sub), draftData: body.draftData ?? item.draftData },
    })
    if (locked.count === 0) {
      return NextResponse.json({ success: false, error: '此派案已被取走' }, { status: 409 })
    }
    const updated = await prisma.dispatchQueue.findUnique({ where: { id } })
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
