import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { canDispatch } from '@/lib/permissions'
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

// 派案池刪除：僅刪除「待取件」的派案記錄（尚無公證編號，不涉及跳號）
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (!canDispatch(session.role) && session.role !== 'sysadmin') {
    return NextResponse.json({ success: false, error: '無權限刪除' }, { status: 403 })
  }

  const id = parseInt(params.id)
  const item = await prisma.dispatchQueue.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ success: false, error: '找不到派案' }, { status: 404 })

  // 已取件者已轉為案件，須改由案件端刪除
  if (item.status !== '待取件') {
    return NextResponse.json({ success: false, error: '此派案已被取件，無法刪除' }, { status: 409 })
  }
  // 部門主管僅可刪除本部門派案（副總／行政／系統管理員不限）
  if (session.role === 'dept_manager' && item.assignedDepartmentId !== session.departmentId) {
    return NextResponse.json({ success: false, error: '僅可刪除本部門派案' }, { status: 403 })
  }

  await prisma.dispatchQueue.delete({ where: { id } })
  return NextResponse.json({ success: true })
}
