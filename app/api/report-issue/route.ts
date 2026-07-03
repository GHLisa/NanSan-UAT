import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildReportIssueWhere, type ReportIssueTab } from '@/lib/reportIssue'

// [2026/07/03] - Lisa - 出具報告清單：以文件為單位，列「已通過審核流程」的文件，
// 依 tab 分待出具（尚未登錄出具日期）/ 已出具，供行政人員與系統管理員操作。

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'admin_staff' && session.role !== 'sysadmin') {
    return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const tab: ReportIssueTab = searchParams.get('tab') === 'issued' ? 'issued' : 'pending'
  const documentType = searchParams.get('documentType')
  const keyword = searchParams.get('keyword')?.trim() || null
  // 出具日期區間（僅「已出具」分頁生效；預設由前端帶當年度，避免歷年資料一次載入）
  const dateFrom = searchParams.get('dateFrom')
  const dateTo = searchParams.get('dateTo')

  const where = buildReportIssueWhere(session, tab, documentType, keyword, dateFrom, dateTo)

  const reviews = await prisma.caseReview.findMany({
    where,
    include: {
      case: { select: { caseNumber: true, insuredName: true, department: { select: { name: true } } } },
      submitter: { select: { name: true } },
      reviewer: { select: { name: true } },
      approver: { select: { name: true } },
      reportIssuer: { select: { name: true } },
    },
    take: 300,
  })

  const data = reviews.map((r) => {
    // 最後簽核通過時間：需執行副總者取 approvedAt，否則取主管複核 reviewedAt
    const lastApprovedAt = r.requiresVP ? r.approvedAt : r.reviewedAt
    return {
      id: r.id,
      caseId: r.caseId,
      caseNumber: r.case.caseNumber,
      insuredName: r.case.insuredName,
      departmentName: r.case.department.name,
      documentType: r.documentType,
      submitterName: r.submitter.name,
      finalApproverName: (r.requiresVP ? r.approver?.name : r.reviewer.name) ?? null,
      lastApprovedAt: lastApprovedAt?.toISOString() ?? null,
      reportIssuedAt: r.reportIssuedAt?.toISOString() ?? null,
      reportIssuerName: r.reportIssuer?.name ?? null,
    }
  })

  // 待出具：依最後簽核通過時間由舊到新（先通過先處理）；已出具：依出具日期由新到舊
  data.sort((a, b) =>
    tab === 'issued'
      ? (b.reportIssuedAt ?? '').localeCompare(a.reportIssuedAt ?? '')
      : (a.lastApprovedAt ?? '').localeCompare(b.lastApprovedAt ?? ''),
  )

  return NextResponse.json({ success: true, data })
}
