import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const ActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'vp_approve', 'vp_reject', 'mid_approve', 'mid_reject']),
  remarks: z.string().optional(),
})

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const id = parseInt(params.id)
  const body = ActionSchema.parse(await req.json())
  const empId = parseInt(session.sub)
  const now = new Date()

  const review = await prisma.caseReview.findUnique({ where: { id } })
  if (!review) return NextResponse.json({ success: false, error: '找不到審核記錄' }, { status: 404 })

  let updateData: Record<string, unknown> = {}

  switch (body.action) {
    case 'approve':
      // 主管複核通過 → 依 requiresMidApproval / requiresVP cascade 到下一關
      updateData = {
        reviewStatus: '已核准',
        reviewedAt: now,
        reviewerId: empId,
        reviewRemarks: body.remarks ?? null,
      }
      if (review.requiresMidApproval) {
        updateData.midApprovalStatus = '待副總審核'
      } else if (review.requiresVP) {
        updateData.approvalStatus = '待執行副總閱'
      }
      break

    case 'reject':
      updateData = {
        reviewStatus: '退回',
        reviewedAt: now,
        reviewerId: empId,
        reviewRemarks: body.remarks ?? null,
      }
      break

    case 'mid_approve':
      // 中間副總審核通過 → cascade 到執行副總閱
      updateData = {
        midApprovalStatus: '已核准',
        midApprovedAt: now,
        midApproverId: empId,
        midApprovalRemarks: body.remarks ?? null,
        approvalStatus: '待執行副總閱',
      }
      break

    case 'mid_reject':
      updateData = {
        midApprovalStatus: '退回',
        midApprovedAt: now,
        midApproverId: empId,
        midApprovalRemarks: body.remarks ?? null,
      }
      break

    case 'vp_approve':
      updateData = {
        approvalStatus: '已核准',
        approvedAt: now,
        approverId: empId,
        approvalRemarks: body.remarks ?? null,
      }
      break

    case 'vp_reject':
      updateData = {
        approvalStatus: '退回',
        approvedAt: now,
        approverId: empId,
        approvalRemarks: body.remarks ?? null,
      }
      break
  }

  const updated = await prisma.caseReview.update({ where: { id }, data: updateData })

  return NextResponse.json({ success: true, data: { id: updated.id } })
}
