import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// [2026/07/03] - Lisa - 出具報告登錄／取消：行政人員（限本部門，無部門則全公司）與系統管理員可操作。
// reportIssuedDate 為 null → 取消出具（清除日期）；字串（YYYY-MM-DD）→ 登錄出具報告日期。

const PatchSchema = z.object({
  reportIssuedDate: z.string().nullable(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (session.role !== 'admin_staff' && session.role !== 'sysadmin') {
    return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })
  }

  const id = parseInt(params.id)
  let body: z.infer<typeof PatchSchema>
  try {
    body = PatchSchema.parse(await req.json())
  } catch {
    return NextResponse.json({ success: false, error: '操作格式錯誤' }, { status: 400 })
  }

  const review = await prisma.caseReview.findUnique({
    where: { id },
    include: { case: { select: { departmentId: true } } },
  })
  if (!review) return NextResponse.json({ success: false, error: '找不到審核記錄' }, { status: 404 })

  // 行政人員有部門者限本部門
  if (
    session.role === 'admin_staff' &&
    session.departmentId != null &&
    review.case.departmentId !== session.departmentId
  ) {
    return NextResponse.json({ success: false, error: '僅可處理本部門案件' }, { status: 403 })
  }

  // 僅可對「已通過整個審核流程」的文件登錄出具
  const passed =
    review.recordStatus == null &&
    (review.requiresVP ? review.approvalStatus === '已核准' : review.reviewStatus === '已核准')
  if (!passed) {
    return NextResponse.json({ success: false, error: '該文件尚未通過審核流程，無法出具報告' }, { status: 409 })
  }

  const empId = parseInt(session.sub)

  if (body.reportIssuedDate === null) {
    await prisma.caseReview.update({
      where: { id },
      data: { reportIssuedAt: null, reportIssuedBy: null },
    })
    return NextResponse.json({ success: true, data: { id, reportIssuedAt: null } })
  }

  const issuedAt = new Date(body.reportIssuedDate)
  if (isNaN(issuedAt.getTime())) {
    return NextResponse.json({ success: false, error: '出具報告日期格式錯誤' }, { status: 400 })
  }

  await prisma.caseReview.update({
    where: { id },
    data: { reportIssuedAt: issuedAt, reportIssuedBy: empId },
  })
  return NextResponse.json({ success: true, data: { id, reportIssuedAt: issuedAt.toISOString() } })
}
