import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

// 登入紀錄查詢（LoginLog）— 僅系統管理員可查
// 支援篩選：q（帳號／姓名／IP 關鍵字）、status（success/fail/locked）
// 預設回傳最新 500 筆，依時間新到舊排序
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const q = (searchParams.get('q') ?? '').trim()
  const status = searchParams.get('status') ?? ''

  const where: Prisma.LoginLogWhereInput = {}
  if (status) where.status = status
  if (q) {
    where.OR = [
      { username: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { ip: { contains: q, mode: 'insensitive' } },
    ]
  }

  const rows = await prisma.loginLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  return NextResponse.json({
    success: true,
    data: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      employeeId: r.employeeId,
      username: r.username,
      name: r.name,
      status: r.status,
      reason: r.reason,
      ip: r.ip,
      userAgent: r.userAgent,
    })),
  })
}
