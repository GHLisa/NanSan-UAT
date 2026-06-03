import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const tab = searchParams.get('tab') ?? 'pending'  // 'pending' | 'pendingVP'
  const empId = parseInt(session.sub)
  const { role, departmentId } = session

  // ── 角色可見範圍 WHERE ────────────────────────────────────────────────
  let scopeWhere: Record<string, unknown> = {}

  if (role === 'vp' || role === 'sysadmin') {
    // VP/sysadmin 看全部
    scopeWhere = {}
  } else if (role === 'team_lead' || role === 'dept_manager') {
    // 主管：本部門案件 OR 被指定為中間副總
    scopeWhere = {
      OR: [
        ...(departmentId ? [{ case: { departmentId } }] : []),
        { midApproverId: empId },
      ],
    }
  } else if (role === 'handler' || role === 'admin_staff') {
    // 承辦人：自己被指派的案件
    scopeWhere = {
      case: { assignments: { some: { employeeId: empId } } },
    }
  }

  // ── Tab 篩選 ──────────────────────────────────────────────────────────
  let tabWhere: Record<string, unknown> = {}

  if (tab === 'pendingVP') {
    tabWhere = { approvalStatus: '待執行副總閱', requiresVP: true }
  } else {
    // pending: reviewStatus='待複核' OR midApprovalStatus='待副總審核'(for this user)
    tabWhere = {
      OR: [
        { reviewStatus: '待複核' },
        { midApprovalStatus: '待副總審核', midApproverId: empId },
      ],
    }
  }

  const where = {
    AND: [scopeWhere, tabWhere].filter(w => Object.keys(w).length > 0),
  }

  const reviews = await prisma.caseReview.findMany({
    where: where.AND.length > 0 ? where : {},
    include: {
      case: { select: { caseNumber: true, insuredName: true, departmentId: true } },
      submitter: { select: { name: true } },
      reviewer: { select: { name: true } },
      approver: { select: { name: true } },
      midApprover: { select: { name: true } },
    },
    orderBy: { submittedAt: 'desc' },
    take: 200,
  })

  return NextResponse.json({
    success: true,
    data: reviews.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      caseNumber: r.case.caseNumber,
      insuredName: r.case.insuredName,
      documentType: r.documentType,
      checkedDocuments: r.checkedDocuments ? tryParseJson(r.checkedDocuments) : [],
      submittedBy: r.submittedBy,
      submitterName: r.submitter.name,
      submittedAt: r.submittedAt.toISOString(),
      submissionNotes: r.submissionNotes,
      reviewerId: r.reviewerId,
      reviewerName: r.reviewer.name,
      reviewStatus: r.reviewStatus,
      reviewRemarks: r.reviewRemarks,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      requiresVP: r.requiresVP,
      requiresMidApproval: r.requiresMidApproval,
      approverId: r.approverId,
      approverName: r.approver?.name ?? null,
      approvalStatus: r.approvalStatus,
      approvalRemarks: r.approvalRemarks,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      midApproverId: r.midApproverId,
      midApproverName: r.midApprover?.name ?? null,
      midApprovalStatus: r.midApprovalStatus,
      midApprovalRemarks: r.midApprovalRemarks,
      midApprovedAt: r.midApprovedAt?.toISOString() ?? null,
      interimTypes: r.interimTypes,
      interimAmount: r.interimAmount,
      feeReversed: r.feeReversed,
    })),
  })
}

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return s }
}

const SubmitReviewSchema = z.object({
  caseId: z.number(),
  documentType: z.string(),
  reviewerId: z.number(),
  checkedDocuments: z.array(z.string()).optional(),
  submissionNotes: z.string().optional(),
  requiresVP: z.boolean().optional(),
  requiresMidApproval: z.boolean().optional(),
  midApproverId: z.number().nullable().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const body = SubmitReviewSchema.parse(await req.json())

  const review = await prisma.caseReview.create({
    data: {
      caseId: body.caseId,
      documentType: body.documentType,
      reviewerId: body.reviewerId,
      checkedDocuments: body.checkedDocuments ? JSON.stringify(body.checkedDocuments) : null,
      submissionNotes: body.submissionNotes,
      requiresVP: body.requiresVP ?? false,
      requiresMidApproval: body.requiresMidApproval ?? false,
      midApproverId: body.midApproverId ?? null,
      submittedBy: parseInt(session.sub),
      reviewStatus: '待複核',
    },
  })

  return NextResponse.json({ success: true, data: { id: review.id } }, { status: 201 })
}
