import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

function parseJsonArray(s: string | null): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : (typeof v === 'string' && v ? [v] : [])
  } catch {
    return s ? [s] : []
  }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const id = parseInt(params.id)
  const c = await prisma.case.findUnique({
    where: { id },
    include: {
      department: { select: { name: true, code: true } },
      insuranceCompany: { select: { name: true, code: true } },
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
      dispatchEntry: { select: { assignmentNotes: true } },
    },
  })

  if (!c) return NextResponse.json({ success: false, error: '找不到案件' }, { status: 404 })

  return NextResponse.json({
    success: true,
    data: {
      ...c,
      departmentName: c.department.name,
      departmentCode: c.department.code,
      insuranceCompanyName: c.insuranceCompany.name,
      insuranceCompanyCode: c.insuranceCompany.code,
      brokerCompanyName: c.brokerCompany?.name ?? null,
      assignmentNotes: c.dispatchEntry?.assignmentNotes ?? null,
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
        role: a.role, contributionRatio: a.contributionRatio,
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
        checkedDocuments: parseJsonArray(r.checkedDocuments), submittedBy: r.submittedBy,
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
        interimTypes: parseJsonArray(r.interimTypes), interimAmount: r.interimAmount, feeReversed: r.feeReversed,
        recordStatus: r.recordStatus, // [2026/06/18] - Lisa - 方案1/2 終結狀態（已重送/已放棄）
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

// FR-77：修改記錄欄位對照（移植自 demo TRACKED_FIELDS）
const FIELD_LABELS: Record<string, string> = {
  insuranceCompanyId: '保險公司',
  brokerCompanyId: '保代公司',
  insuranceContact: '保險公司承辦人',
  policyNumber: '保單號碼',
  coInsurers: '共保資訊',
  insuredName: '被保險人',
  insuranceType: '險種',
  incidentCause: '出險原因',
  incidentLocation: '出險地點',
  parkingStatus: '停泊案件狀態',
  incidentDate: '出險日期',
  commissionDate: '委託日期',
  currentStage: '案件階段',
  contactFormStatus: '聯絡單狀態',
  contactReturnDate: '回傳日期',
  preliminaryReportDate: '初步報告日期',
  finalReportDate: '最終報告日期',
  nasFolder: 'NAS 路徑',
  deductible: '自負額',
  estimatedAmount: '預估金額',
  estimatedFee: '預估公證費',
  adjustmentAmount: '理算損失額',
  salvageValue: '殘餘物價值',
  finalAmount: '最終金額',
  travelOtherExpense: '差旅其他費',
  actualFee: '實際公證費',
  isSpecialCase: '特殊案件',
  notes: '交辦事項',
  status: '狀態',
}

const DATE_FIELDS = new Set([
  'incidentDate', 'commissionDate', 'preliminaryReportDate', 'finalReportDate', 'closeDate', 'contactReturnDate',
])

// 案件金額欄位採 BigInt（對齊 ERD bigint，避免大額理算溢位 int4）
const AMOUNT_BIGINT_FIELDS = new Set([
  'estimatedAmount', 'deductible', 'adjustmentAmount', 'salvageValue', 'finalAmount',
])

// FR-35/37/58：確認呼叫者可編輯本案
async function assertCanEdit(
  session: { sub: string; role: string; departmentId: number | null },
  caseId: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    include: { assignments: { select: { employeeId: true } } },
  })
  if (!c) return { ok: false, status: 404, error: '找不到案件' }
  if (c.status !== '未決') {
    return { ok: false, status: 409, error: '已決／銷案案件不可編輯' }
  }
  const empId = parseInt(session.sub)
  const isAssignee = c.assignments.some((a) => a.employeeId === empId)
  // 主管／系統管理員可調整本部門案件（FR-07）
  // [2026/06/18] - Lisa - 行政人員代為編輯（非審核）：有部門限本部門、無部門全公司
  const isManager =
    (session.role === 'dept_manager' && session.departmentId === c.departmentId) ||
    session.role === 'sysadmin' ||
    (session.role === 'admin_staff' && (session.departmentId == null || session.departmentId === c.departmentId))
  if (!isAssignee && !isManager) {
    return { ok: false, status: 403, error: '非本案承辦人，無權編輯' }
  }
  return { ok: true }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const id = parseInt(params.id)
  const body = await req.json() as Record<string, unknown>
  const empId = parseInt(session.sub)

  const existing = await prisma.case.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ success: false, error: '找不到案件' }, { status: 404 })

  // ── FR-11/48 撤案 ──────────────────────────────────────────────
  if (body.action === 'cancel') {
    const perm = await assertCanEdit(session, id)
    if (!perm.ok) return NextResponse.json({ success: false, error: perm.error }, { status: perm.status })

    const cancelReason = String(body.cancelReason ?? '').trim()
    if (!cancelReason) {
      return NextResponse.json({ success: false, error: '撤案原因必填' }, { status: 400 })
    }

    // 檢查待審文件（待複核 / 待加簽審核 / 待執行副總閱）
    const pending = await prisma.caseReview.findMany({
      where: {
        caseId: id,
        OR: [
          { reviewStatus: '待複核' },
          { midApprovalStatus: '待加簽審核' },
          { approvalStatus: '待執行副總閱' },
        ],
      },
      select: { documentType: true },
    })
    if (pending.length > 0) {
      const docs = [...new Set(pending.map((p) => p.documentType))]
      return NextResponse.json(
        { success: false, error: `以下文件審核中，無法撤案：${docs.join('、')}` },
        { status: 409 },
      )
    }

    await prisma.$transaction([
      prisma.case.update({
        where: { id },
        data: {
          status: '銷案',
          notes: `${existing.notes ? existing.notes + '\n' : ''}【撤案原因】${cancelReason}`,
        },
      }),
      prisma.caseLog.create({
        data: {
          caseId: id, employeeId: empId, fieldName: '狀態',
          oldValue: existing.status, newValue: '銷案', logType: 'cancel',
        },
      }),
    ])
    return NextResponse.json({ success: true })
  }

  // ── 一般編輯（含承辦人整批覆寫 FR-45）─────────────────────────
  const perm = await assertCanEdit(session, id)
  if (!perm.ok) return NextResponse.json({ success: false, error: perm.error }, { status: perm.status })

  // 承辦人整批覆寫（FR-33/46/65）
  const assignees = body.assignees as
    | { employeeId: number; role: string; contributionRatio: number }[]
    | undefined

  if (assignees) {
    const total = assignees.reduce((s, a) => s + (a.contributionRatio ?? 0), 0)
    if (Math.abs(total - 1.0) > 0.01) {
      return NextResponse.json(
        { success: false, error: '承辦比例合計必須等於 100%' },
        { status: 400 },
      )
    }
  }

  // 欄位變更比對 + 寫 log（FR-77）
  const updates: Record<string, unknown> = {}
  const logs: { fieldName: string; oldValue: string | null; newValue: string | null }[] = []

  for (const [key, value] of Object.entries(body)) {
    if (key === 'assignees' || key === 'action' || key === 'cancelReason') continue
    if (!(key in existing)) continue

    let normalized: unknown = value
    if (DATE_FIELDS.has(key) && value) normalized = new Date(value as string)
    else if (AMOUNT_BIGINT_FIELDS.has(key)) normalized = value == null || value === '' ? null : BigInt(value as number)

    const oldRaw = (existing as Record<string, unknown>)[key]
    const oldVal = oldRaw instanceof Date ? oldRaw.toISOString().slice(0, 10) : String(oldRaw ?? '')
    const cmpNew = normalized instanceof Date ? (normalized as Date).toISOString().slice(0, 10) : String(value ?? '')

    if (oldVal !== cmpNew) {
      updates[key] = normalized
      logs.push({ fieldName: FIELD_LABELS[key] ?? key, oldValue: oldVal || null, newValue: cmpNew || null })
    }
  }

  const hasFieldChanges = Object.keys(updates).length > 0
  if (!hasFieldChanges && !assignees) {
    return NextResponse.json({ success: true, data: existing })
  }

  await prisma.$transaction(async (tx) => {
    if (hasFieldChanges) {
      await tx.case.update({ where: { id }, data: updates })
    }
    if (logs.length > 0) {
      await tx.caseLog.createMany({
        data: logs.map((l) => ({
          caseId: id, employeeId: empId,
          fieldName: l.fieldName, oldValue: l.oldValue, newValue: l.newValue, logType: 'edit',
        })),
      })
    }
    if (assignees) {
      await tx.caseAssignment.deleteMany({ where: { caseId: id } })
      await tx.caseAssignment.createMany({
        data: assignees.map((a) => ({
          caseId: id,
          employeeId: a.employeeId,
          role: a.role,
          contributionRatio: a.contributionRatio,
        })),
      })
      await tx.caseLog.create({
        data: {
          caseId: id, employeeId: empId, fieldName: '承辦人',
          newValue: '承辦人已變更', logType: 'edit',
        },
      })
    }
  })

  const updated = await prisma.case.findUnique({ where: { id } })
  return NextResponse.json({ success: true, data: updated })
}
