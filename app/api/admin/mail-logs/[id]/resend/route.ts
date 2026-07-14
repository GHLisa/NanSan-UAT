import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/email'

// [2026/07/15] - Lisa - 人工補寄：依既有 MailLog 的收件人與內文重新寄送。
// 用於補送先前失敗（如 HiNet 452 速率節流）的信；重送會產生一筆新的 MailLog 稽核紀錄，
// 並自動享有 lib/email.ts 的暫時性錯誤退避重試與速率節流。僅系統管理員可用。
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'sysadmin') return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const id = parseInt(params.id, 10)
  if (Number.isNaN(id)) return NextResponse.json({ success: false, error: '參數錯誤' }, { status: 400 })

  const log = await prisma.mailLog.findUnique({ where: { id } })
  if (!log) return NextResponse.json({ success: false, error: '找不到發信紀錄' }, { status: 404 })

  if (!log.bodyHtml) {
    return NextResponse.json({ success: false, error: '此筆紀錄未保存內文，無法補寄（早期紀錄）' }, { status: 400 })
  }

  // recipients 儲存為「姓名 <email>」以逗號分隔的合併字串（原 to + cc）；補寄一律以 to 送出
  const recipients = log.recipients.split(',').map(s => s.trim()).filter(Boolean)
  if (recipients.length === 0) {
    return NextResponse.json({ success: false, error: '此筆紀錄無有效收件人，無法補寄' }, { status: 400 })
  }

  // 主旨已含「系統測試(UAT)」前綴，sendMail 內的 withSubjectPrefix 不會重複加上
  const result = await sendMail({
    to: recipients,
    subject: log.subject,
    html: log.bodyHtml,
    category: log.category,
    caseId: log.caseId,
    caseNumber: log.caseNumber,
  })

  return NextResponse.json({
    success: result.ok,
    data: { sent: result.sent, skipped: result.skipped },
    error: result.ok ? undefined : result.error,
  })
}
