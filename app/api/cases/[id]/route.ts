import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { canDispatch } from '@/lib/permissions'
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
  coverageLimit: '保額(賠償限額)',
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
  'estimatedAmount', 'coverageLimit', 'deductible', 'adjustmentAmount', 'salvageValue', 'finalAmount',
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
  // [2026/07/08] - Lisa - 全面開放編輯政策：案件在文件審核中（待複核／待加簽審核／待執行副總閱）仍允許編輯欄位，
  // 不阻擋 pending review；所有異動皆寫入 CaseLog，前端於送審記錄標示「送審後已修改」提醒審核者。
  // （撤案 action='cancel' 仍維持審核中不可撤案的既有防護，不受此政策影響。）
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

  // ── 結案日期(closeDate) 溯及修正 ──────────────────────────────
  // 繞過「已決不可編輯」鎖，僅開放 sysadmin／本部門主管／行政人員，且僅能改此欄位、寫修改記錄
  if (body.action === 'fixCloseDate') {
    const allowed =
      session.role === 'sysadmin' ||
      (session.role === 'dept_manager' && session.departmentId === existing.departmentId) ||
      (session.role === 'admin_staff' && (session.departmentId == null || session.departmentId === existing.departmentId))
    if (!allowed) return NextResponse.json({ success: false, error: '無權限修正結案日期' }, { status: 403 })
    if (existing.status !== '已決') {
      return NextResponse.json({ success: false, error: '僅已決案件可修正結案日期' }, { status: 400 })
    }
    const raw = String(body.closeDate ?? '').trim()
    const newDate = raw ? new Date(raw) : null
    if (!newDate || isNaN(newDate.getTime())) {
      return NextResponse.json({ success: false, error: '請提供正確的結案日期' }, { status: 400 })
    }
    const oldStr = existing.closeDate ? existing.closeDate.toISOString().slice(0, 10) : ''
    const newStr = newDate.toISOString().slice(0, 10)
    if (oldStr !== newStr) {
      await prisma.$transaction([
        prisma.case.update({ where: { id }, data: { closeDate: newDate } }),
        prisma.caseLog.create({
          data: {
            caseId: id, employeeId: empId, fieldName: '結案日期',
            oldValue: oldStr || null, newValue: newStr, logType: 'edit',
          },
        }),
      ])
    }
    const updated = await prisma.case.findUnique({ where: { id } })
    return NextResponse.json({ success: true, data: updated })
  }

  // ── 已決案件金額資訊修正 ──────────────────────────────
  // 繞過「已決不可編輯」鎖，僅開放 sysadmin／本部門主管／行政人員，且僅能改金額欄位、寫修改記錄
  if (body.action === 'fixAmounts') {
    const allowed =
      session.role === 'sysadmin' ||
      (session.role === 'dept_manager' && session.departmentId === existing.departmentId) ||
      (session.role === 'admin_staff' && (session.departmentId == null || session.departmentId === existing.departmentId))
    if (!allowed) return NextResponse.json({ success: false, error: '無權限修正金額資訊' }, { status: 403 })
    if (existing.status !== '已決') {
      return NextResponse.json({ success: false, error: '僅已決案件可修正金額資訊' }, { status: 400 })
    }

    const AMOUNT_FIELDS = [
      'estimatedAmount', 'deductible', 'coverageLimit', 'estimatedFee',
      'adjustmentAmount', 'salvageValue', 'finalAmount', 'actualFee', 'travelOtherExpense',
    ]
    const updates: Record<string, unknown> = {}
    const logs: { fieldName: string; oldValue: string | null; newValue: string | null }[] = []

    for (const key of AMOUNT_FIELDS) {
      if (!(key in body)) continue
      const value = body[key]
      const normalized: bigint | number | null =
        value == null || value === ''
          ? null
          : AMOUNT_BIGINT_FIELDS.has(key)
            ? BigInt(Math.trunc(Number(value)))
            : Math.trunc(Number(value))

      const oldRaw = (existing as Record<string, unknown>)[key] as bigint | number | null
      const oldStr = oldRaw == null ? '' : oldRaw.toString()
      const newStr = normalized == null ? '' : normalized.toString()

      if (oldStr !== newStr) {
        updates[key] = normalized
        logs.push({ fieldName: FIELD_LABELS[key] ?? key, oldValue: oldStr || null, newValue: newStr || null })
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.$transaction([
        prisma.case.update({ where: { id }, data: updates }),
        prisma.caseLog.createMany({
          data: logs.map((l) => ({
            caseId: id, employeeId: empId,
            fieldName: l.fieldName, oldValue: l.oldValue, newValue: l.newValue, logType: 'edit',
          })),
        }),
      ])
    }
    const updated = await prisma.case.findUnique({ where: { id } })
    return NextResponse.json({ success: true, data: updated })
  }

  // ── 一般編輯（含承辦人整批覆寫 FR-45）─────────────────────────
  const perm = await assertCanEdit(session, id)
  if (!perm.ok) return NextResponse.json({ success: false, error: perm.error }, { status: perm.status })

  // 承辦人整批覆寫（FR-33/46/65）
  const assignees = body.assignees as
    | { employeeId: number; role: string; contributionRatio: number }[]
    | undefined

  let assigneesChanged = false
  if (assignees) {
    const total = assignees.reduce((s, a) => s + (a.contributionRatio ?? 0), 0)
    if (Math.abs(total - 1.0) > 0.01) {
      return NextResponse.json(
        { success: false, error: '承辦比例合計必須等於 100%' },
        { status: 400 },
      )
    }
    // 承辦人須恰有一位主辦
    if (assignees.filter((a) => a.role === '主辦').length !== 1) {
      return NextResponse.json({ success: false, error: '承辦人須恰有一位主辦' }, { status: 400 })
    }
    // [2026/07/08] - Lisa - 與現有承辦人比對（不分順序）：未變更則不刪改、不寫 log，避免每次儲存都產生「承辦人已變更」
    const existingAssign = await prisma.caseAssignment.findMany({
      where: { caseId: id },
      select: { employeeId: true, role: true, contributionRatio: true },
    })
    const normAssign = (list: { employeeId: number; role: string; contributionRatio: number }[]) =>
      list.map((a) => `${a.employeeId}|${a.role}|${a.contributionRatio}`).sort().join(';')
    assigneesChanged = normAssign(existingAssign) !== normAssign(assignees)
  }

  // 共保資訊整批覆寫（與建案一致；主保人須保留比例，合計須 < 100%）
  const coInsurers = body.coInsurers as
    | { companyId: number | null; policyNumber: string; ratio: number }[]
    | undefined
  let coInsurersChanged = false
  if (coInsurers) {
    for (const ci of coInsurers) {
      if (!ci.policyNumber?.trim()) {
        return NextResponse.json({ success: false, error: '共保資訊：保單號碼必填' }, { status: 400 })
      }
      if (!ci.ratio || ci.ratio <= 0) {
        return NextResponse.json({ success: false, error: '共保資訊：共保比例必填' }, { status: 400 })
      }
    }
    const coSum = coInsurers.reduce((s, c) => s + (c.ratio ?? 0), 0)
    if (coSum >= 100) {
      return NextResponse.json({ success: false, error: '共保比例合計已達 100%，主保人須保留比例' }, { status: 400 })
    }
    // 與現有共保比對（不分順序）：未變更則不動 DB、不寫 log
    const existingCo = await prisma.caseCoInsurer.findMany({
      where: { caseId: id },
      select: { companyId: true, policyNumber: true, ratio: true },
    })
    const normCo = (list: { companyId: number | null; policyNumber: string; ratio: number }[]) =>
      list.map((c) => `${c.companyId ?? ''}|${(c.policyNumber ?? '').trim()}|${c.ratio}`).sort().join(';')
    coInsurersChanged = normCo(existingCo) !== normCo(coInsurers)
  }

  // [2026/07/01] - Lisa - 保險公司承辦人改必填：編輯時若帶入此欄位不可為空
  if ('insuranceContact' in body && !String(body.insuranceContact ?? '').trim()) {
    return NextResponse.json({ success: false, error: '保險公司承辦人必填' }, { status: 400 })
  }

  // 欄位變更比對 + 寫 log（FR-77）
  const updates: Record<string, unknown> = {}
  const logs: { fieldName: string; oldValue: string | null; newValue: string | null }[] = []

  for (const [key, value] of Object.entries(body)) {
    if (key === 'assignees' || key === 'coInsurers' || key === 'action' || key === 'cancelReason' || key === 'caseNumber') continue // caseNumber 成案後不可修改
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
  if (!hasFieldChanges && !assigneesChanged && !coInsurersChanged) {
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
    if (assignees && assigneesChanged) {
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
    if (coInsurers && coInsurersChanged) {
      await tx.caseCoInsurer.deleteMany({ where: { caseId: id } })
      if (coInsurers.length > 0) {
        await tx.caseCoInsurer.createMany({
          data: coInsurers.map((ci) => ({
            caseId: id,
            companyId: ci.companyId ?? null,
            policyNumber: ci.policyNumber,
            ratio: ci.ratio,
          })),
        })
      }
      await tx.caseLog.create({
        data: {
          caseId: id, employeeId: empId, fieldName: '共保資訊',
          newValue: '共保資訊已變更', logType: 'edit',
        },
      })
    }
  })

  const updated = await prisma.case.findUnique({ where: { id } })
  return NextResponse.json({ success: true, data: updated })
}

// 派案池刪除案件：連同關聯紀錄一併刪除。
// 注意：公證編號序號（case_number_seq）採遞增不回補，刪除已配號案件會造成公證編號跳號。
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (!canDispatch(session.role) && session.role !== 'sysadmin') {
    return NextResponse.json({ success: false, error: '無權限刪除' }, { status: 403 })
  }

  const id = parseInt(params.id)
  const c = await prisma.case.findUnique({ where: { id } })
  if (!c) return NextResponse.json({ success: false, error: '找不到案件' }, { status: 404 })

  // 已決／銷案案件含結算等紀錄，不可刪除
  if (c.status !== '未決') {
    return NextResponse.json({ success: false, error: '已決／銷案案件不可刪除' }, { status: 409 })
  }
  // 部門主管僅可刪除本部門案件（副總／行政／系統管理員不限）
  if (session.role === 'dept_manager' && c.departmentId !== session.departmentId) {
    return NextResponse.json({ success: false, error: '僅可刪除本部門案件' }, { status: 403 })
  }

  // 依外鍵相依序刪除子表（Case 關聯未設 onDelete cascade）；MailLog 為去正規化快照不刪
  await prisma.$transaction(async (tx) => {
    await tx.settlementSplit.deleteMany({ where: { settlement: { caseId: id } } })
    await tx.settlement.deleteMany({ where: { caseId: id } })
    await tx.notification.deleteMany({ where: { caseId: id } })
    await tx.caseReview.deleteMany({ where: { caseId: id } })
    await tx.caseLog.deleteMany({ where: { caseId: id } })
    await tx.caseNote.deleteMany({ where: { caseId: id } })
    await tx.caseProgress.deleteMany({ where: { caseId: id } })
    await tx.caseAssignment.deleteMany({ where: { caseId: id } })
    await tx.caseCoInsurer.deleteMany({ where: { caseId: id } })
    await tx.case.delete({ where: { id } })
  })

  return NextResponse.json({ success: true })
}
