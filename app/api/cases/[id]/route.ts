import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const id = parseInt(params.id)
  const c = await prisma.case.findUnique({
    where: { id },
    include: {
      department: { select: { name: true } },
      insuranceCompany: { select: { name: true } },
      brokerCompany: { select: { name: true } },
      coInsurers: { include: { company: { select: { name: true } } } },
      assignments: { include: { employee: { select: { name: true } } } },
      progress: { include: { creator: { select: { name: true } } }, orderBy: { progressDate: 'desc' } },
      caseNotes: { include: { creator: { select: { name: true } } }, orderBy: { noteDate: 'desc' } },
      logs: { include: { employee: { select: { name: true } } }, orderBy: { changedAt: 'desc' } },
      reviews: {
        include: {
          submitter: { select: { name: true } },
          reviewer: { select: { name: true } },
          approver: { select: { name: true } },
          midApprover: { select: { name: true } },
        },
        orderBy: { submittedAt: 'desc' },
      },
      settlement: { include: { splits: { include: { employee: { select: { name: true } } } } } },
    },
  })

  if (!c) return NextResponse.json({ success: false, error: '找不到案件' }, { status: 404 })

  return NextResponse.json({
    success: true,
    data: {
      ...c,
      departmentName: c.department.name,
      insuranceCompanyName: c.insuranceCompany.name,
      brokerCompanyName: c.brokerCompany?.name ?? null,
      incidentDate: c.incidentDate.toISOString(),
      commissionDate: c.commissionDate.toISOString(),
      preliminaryReportDate: c.preliminaryReportDate?.toISOString() ?? null,
      finalReportDate: c.finalReportDate?.toISOString() ?? null,
      closeDate: c.closeDate?.toISOString() ?? null,
      contactReturnDate: c.contactReturnDate?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      coInsurers: c.coInsurers.map((ci) => ({
        id: ci.id, companyId: ci.companyId, companyName: ci.company?.name ?? null,
        policyNumber: ci.policyNumber, ratio: ci.ratio,
      })),
      assignments: c.assignments.map((a) => ({
        id: a.id, employeeId: a.employeeId, employeeName: a.employee.name,
        role: a.role, contributionRatio: a.contributionRatio, travelOtherExpense: a.travelOtherExpense,
      })),
      progress: c.progress.map((p) => ({
        id: p.id, stage: p.stage, progressDate: p.progressDate.toISOString(),
        description: p.description, createdBy: p.createdBy, creatorName: p.creator.name,
      })),
      caseNotes: c.caseNotes.map((n) => ({
        id: n.id, noteDate: n.noteDate.toISOString(), content: n.content,
        createdBy: n.createdBy, creatorName: n.creator.name,
      })),
      logs: c.logs.map((l) => ({
        id: l.id, changedAt: l.changedAt.toISOString(), fieldName: l.fieldName,
        oldValue: l.oldValue, newValue: l.newValue, logType: l.logType, amount: l.amount,
        employeeId: l.employeeId, employeeName: l.employee.name,
      })),
      reviews: c.reviews.map((r) => ({
        id: r.id, caseId: r.caseId, documentType: r.documentType,
        checkedDocuments: r.checkedDocuments, submittedBy: r.submittedBy,
        submitterName: r.submitter.name, submittedAt: r.submittedAt.toISOString(),
        submissionNotes: r.submissionNotes, reviewerId: r.reviewerId,
        reviewerName: r.reviewer.name, reviewStatus: r.reviewStatus,
        reviewRemarks: r.reviewRemarks, reviewedAt: r.reviewedAt?.toISOString() ?? null,
        requiresVP: r.requiresVP, approverId: r.approverId,
        approverName: r.approver?.name ?? null, approvalStatus: r.approvalStatus,
        approvalRemarks: r.approvalRemarks, approvedAt: r.approvedAt?.toISOString() ?? null,
        requiresMidApproval: r.requiresMidApproval, midApproverId: r.midApproverId,
        midApproverName: r.midApprover?.name ?? null, midApprovalStatus: r.midApprovalStatus,
        midApprovalRemarks: r.midApprovalRemarks, midApprovedAt: r.midApprovedAt?.toISOString() ?? null,
        interimTypes: r.interimTypes, interimAmount: r.interimAmount, feeReversed: r.feeReversed,
      })),
      settlement: c.settlement ? {
        id: c.settlement.id, caseId: c.settlement.caseId,
        reportDate: c.settlement.reportDate.toISOString(),
        baseFee: c.settlement.baseFee, travelExpense: c.settlement.travelExpense,
        totalFee: c.settlement.totalFee, remarks: c.settlement.remarks,
        splits: c.settlement.splits.map((s) => ({
          id: s.id, employeeId: s.employeeId, employeeName: s.employee.name,
          ratio: s.ratio, amount: s.amount,
        })),
      } : null,
    },
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const id = parseInt(params.id)
  const body = await req.json() as Record<string, unknown>

  const existing = await prisma.case.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ success: false, error: '找不到案件' }, { status: 404 })

  // Log changes
  const FIELD_LABELS: Record<string, string> = {
    status: '狀態', currentStage: '流程階段', estimatedAmount: '估計損失',
    finalAmount: '核定損失', actualFee: '實際公證費', notes: '備註',
  }

  const updates: Record<string, unknown> = {}
  const logs: { fieldName: string; oldValue: string | null; newValue: string | null }[] = []

  for (const [key, value] of Object.entries(body)) {
    if (key in existing) {
      const oldVal = String((existing as Record<string, unknown>)[key] ?? '')
      const newVal = String(value ?? '')
      if (oldVal !== newVal) {
        updates[key] = value
        logs.push({ fieldName: FIELD_LABELS[key] ?? key, oldValue: oldVal || null, newValue: newVal || null })
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: true, data: existing })
  }

  const updated = await prisma.case.update({ where: { id }, data: updates })

  if (logs.length > 0) {
    await prisma.caseLog.createMany({
      data: logs.map((l) => ({
        caseId: id, employeeId: parseInt(session.sub),
        fieldName: l.fieldName, oldValue: l.oldValue, newValue: l.newValue, logType: 'edit',
      })),
    })
  }

  return NextResponse.json({ success: true, data: updated })
}
