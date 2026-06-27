import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'

// 發信紀錄查詢（MailLog）— 僅系統管理員可查
// 支援篩選：q（主旨／收件人／案號關鍵字）、status（sent/skipped/failed）、category
// 預設回傳最新 500 筆，依時間新到舊排序
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const q = (searchParams.get('q') ?? '').trim()
  const status = searchParams.get('status') ?? ''
  const category = searchParams.get('category') ?? ''

  const where: Prisma.MailLogWhereInput = {}
  if (status) where.status = status
  if (category) where.category = category
  if (q) {
    where.OR = [
      { subject: { contains: q, mode: 'insensitive' } },
      { recipients: { contains: q, mode: 'insensitive' } },
      { caseNumber: { contains: q, mode: 'insensitive' } },
    ]
  }

  const rows = await prisma.mailLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  return NextResponse.json({
    success: true,
    data: rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      category: r.category,
      subject: r.subject,
      recipients: r.recipients,
      status: r.status,
      sentCount: r.sentCount,
      skippedCount: r.skippedCount,
      caseId: r.caseId,
      caseNumber: r.caseNumber,
      error: r.error,
    })),
  })
}
