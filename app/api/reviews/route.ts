import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const status = searchParams.get('status')
  const tab = searchParams.get('tab') ?? 'reviewer'

  const empId = parseInt(session.sub)

  let where: Record<string, unknown> = {}

  if (tab === 'approver') {
    where = { requiresVP: true, reviewStatus: '已核准' }
    if (status) where.approvalStatus = status
  } else {
    where.reviewerId = empId
    if (status) where.reviewStatus = status
  }

  const reviews = await prisma.caseReview.findMany({
    where,
    include: {
      case: { select: { caseNumber: true, insuredName: true, insuranceType: true } },
      submitter: { select: { name: true } },
      reviewer: { select: { name: true } },
      approver: { select: { name: true } },
    },
    orderBy: { submittedAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({
    success: true,
    data: reviews.map((r) => ({
      id: r.id,
      caseId: r.caseId,
      caseNumber: r.case.caseNumber,
      insuredName: r.case.insuredName,
      insuranceType: r.case.insuranceType,
      documentType: r.documentType,
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
      approverId: r.approverId,
      approverName: r.approver?.name ?? null,
      approvalStatus: r.approvalStatus,
      approvedAt: r.approvedAt?.toISOString() ?? null,
    })),
  })
}

const SubmitReviewSchema = z.object({
  caseId: z.number(),
  documentType: z.string(),
  reviewerId: z.number(),
  checkedDocuments: z.string().optional(),
  submissionNotes: z.string().optional(),
  requiresVP: z.boolean().optional(),
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
      checkedDocuments: body.checkedDocuments,
      submissionNotes: body.submissionNotes,
      requiresVP: body.requiresVP ?? false,
      submittedBy: parseInt(session.sub),
      reviewStatus: '待複核',
    },
  })

  return NextResponse.json({ success: true, data: { id: review.id } }, { status: 201 })
}
