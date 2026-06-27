import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// 發信紀錄單筆明細（含 HTML 內文）— 僅系統管理員可查
// 清單 API 不回傳內文（避免 500 筆 × 大量 HTML 拖慢），改由本端點按需取單筆。
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const id = parseInt(params.id, 10)
  if (Number.isNaN(id)) return NextResponse.json({ success: false, error: '參數錯誤' }, { status: 400 })

  const r = await prisma.mailLog.findUnique({ where: { id } })
  if (!r) return NextResponse.json({ success: false, error: '找不到發信紀錄' }, { status: 404 })

  return NextResponse.json({
    success: true,
    data: {
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
      bodyHtml: r.bodyHtml,
    },
  })
}
