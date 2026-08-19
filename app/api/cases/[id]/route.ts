import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { canDispatch } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
// [2026/07/31] - Lisa - 銷案案件刪除：封存後實刪（含派案紀錄標記、發信紀錄加註、序號重算）
import { archiveAndDeleteCase } from '@/lib/caseArchive'
// [2026/08/05] - Lisa - 初報完成多來源判定（明細頁 SLA 燈號用）
import { isPrelimDone } from '@/lib/reportStage'

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
      // [2026/07/28] - Lisa - 交辦事項：Case 欄位優先（成案後可修改），未設定時回退派案池原始交辦事項
      assignmentNotes: c.assignmentNotes ?? c.dispatchEntry?.assignmentNotes ?? null,
      incidentDate: c.incidentDate.toISOString(),
      commissionDate: c.commissionDate.toISOString(),
      preliminaryReportDate: c.preliminaryReportDate?.toISOString() ?? null,
      finalReportDate: c.finalReportDate?.toISOString() ?? null,
      // [2026/08/05] - Lisa - 初報是否完成（日期／初報文件終審核准／階段已越過初報），供明細頁 SLA 燈號
      prelimDone: isPrelimDone(c),
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
        mergedBilling: r.mergedBilling, // [2026/07/15] - Lisa - 合併送審旗標（節點8亮燈聚合用）
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
  notes: '備註', // [2026/07/28] - Lisa - 修正標籤：Case.notes 對應畫面「備註」（交辦事項另存 assignmentNotes）
  assignmentNotes: '交辦事項',
  status: '狀態',
}

// [2026/07/28] - Lisa - 交辦事項可修改角色：部門主管（限本部門）／行政人員（有部門限本部門、無部門全公司）／
// 執行副總（全公司）／系統管理員（全公司）。承辦人不可修改（交辦事項為交辦方的指示）。
function canEditAssignmentNotes(
  session: { role: string; departmentId: number | null },
  c: { departmentId: number },
): boolean {
  if (session.role === 'sysadmin' || session.role === 'vp') return true
  if (session.role === 'dept_manager') return session.departmentId === c.departmentId
  if (session.role === 'admin_staff') return session.departmentId == null || session.departmentId === c.departmentId
  return false
}

// 交辦事項現值（比對基準）：Case 欄位優先，未設定時回退派案池原始值；空字串代表已被明確清空
async function currentAssignmentNotes(c: { assignmentNotes: string | null; dispatchEntryId: number | null }): Promise<string> {
  if (c.assignmentNotes != null) return c.assignmentNotes
  if (!c.dispatchEntryId) return ''
  const d = await prisma.dispatchQueue.findUnique({
    where: { id: c.dispatchEntryId },
    select: { assignmentNotes: true },
  })
  return d?.assignmentNotes ?? ''
}

const DATE_FIELDS = new Set([
  'incidentDate', 'commissionDate', 'preliminaryReportDate', 'finalReportDate', 'closeDate', 'contactReturnDate',
])

// 案件金額欄位採 BigInt（對齊 ERD bigint，避免大額理算溢位 int4）
const AMOUNT_BIGINT_FIELDS = new Set([
  'estimatedAmount', 'coverageLimit', 'deductible', 'adjustmentAmount', 'salvageValue', 'finalAmount',
])

// FR-35/37/58：確認呼叫者可編輯本案
// [2026/08/19] - Lisa - allowClosedForSysadmin：一般編輯（非撤案）開放系統管理員編輯已決／銷案案件，
// 供更正歷史資料之用；撤案（action='cancel'）不適用，仍維持已結案不可撤案的既有防護。
async function assertCanEdit(
  session: { sub: string; role: string; departmentId: number | null },
  caseId: number,
  opts: { allowClosedForSysadmin?: boolean } = {},
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    include: { assignments: { select: { employeeId: true } } },
  })
  if (!c) return { ok: false, status: 404, error: '找不到案件' }
  if (c.status !== '未決' && !(opts.allowClosedForSysadmin && session.role === 'sysadmin')) {
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

  // ── 交辦事項單獨修改 ────────────────────────────────────────────
  // [2026/07/28] - Lisa - 執行副總無案件編輯權（assertCanEdit 不含 vp），故交辦事項另走此路徑，
  // 由 canEditAssignmentNotes 自行把關；部門主管／行政人員／系統管理員亦可由此或編輯表單修改。
  if (body.action === 'updateAssignmentNotes') {
    if (existing.status !== '未決') {
      return NextResponse.json({ success: false, error: '已決／銷案案件不可修改交辦事項' }, { status: 409 })
    }
    if (!canEditAssignmentNotes(session, existing)) {
      return NextResponse.json({ success: false, error: '無權限修改交辦事項' }, { status: 403 })
    }
    const next = String(body.assignmentNotes ?? '').trim()
    const current = await currentAssignmentNotes(existing)
    if (next === current) return NextResponse.json({ success: true, data: existing })

    await prisma.$transaction([
      prisma.case.update({ where: { id }, data: { assignmentNotes: next } }),
      prisma.caseLog.create({
        data: {
          caseId: id, employeeId: empId, fieldName: '交辦事項',
          oldValue: current || null, newValue: next || null, logType: 'edit',
        },
      }),
    ])
    const updated = await prisma.case.findUnique({ where: { id } })
    return NextResponse.json({ success: true, data: updated })
  }

  // ── 一般編輯（含承辦人整批覆寫 FR-45）─────────────────────────
  const perm = await assertCanEdit(session, id, { allowClosedForSysadmin: true })
  if (!perm.ok) return NextResponse.json({ success: false, error: perm.error }, { status: perm.status })

  // 承辦人整批覆寫（FR-33/46/65）
  const assignees = body.assignees as
    | { employeeId: number; role: string; contributionRatio: number }[]
    | undefined

  let assigneesChanged = false
  // [2026/08/19] - Lisa - 承辦人修改記錄需顯示變更前後名單（含姓名／角色／比例），不再只顯示「已變更」
  let assigneeLogValues: { oldValue: string; newValue: string } | null = null
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

    if (assigneesChanged) {
      const empIds = [...new Set([...existingAssign.map((a) => a.employeeId), ...assignees.map((a) => a.employeeId)])]
      const empRows = await prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, name: true } })
      const nameMap = new Map(empRows.map((e) => [e.id, e.name]))
      const formatList = (list: { employeeId: number; role: string; contributionRatio: number }[]) =>
        list
          .slice()
          .sort((a, b) => (a.role === '主辦' ? 0 : 1) - (b.role === '主辦' ? 0 : 1))
          .map((a) => `${nameMap.get(a.employeeId) ?? a.employeeId}(${a.role} ${Math.round(a.contributionRatio * 100)}%)`)
          .join('、')
      assigneeLogValues = { oldValue: formatList(existingAssign), newValue: formatList(assignees) }
    }
  }

  // 共保資訊整批覆寫（與建案一致；主保人須保留比例，合計須 < 100%）
  const coInsurers = body.coInsurers as
    | { companyId: number | null; policyNumber: string; ratio: number }[]
    | undefined
  let coInsurersChanged = false
  // [2026/08/19] - Lisa - 共保資訊修改記錄需顯示變更前後名單，不再只顯示「已變更」
  let coInsurerLogValues: { oldValue: string; newValue: string } | null = null
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

    if (coInsurersChanged) {
      const companyIds = [...new Set(
        [...existingCo, ...coInsurers].map((c) => c.companyId).filter((v): v is number => v != null),
      )]
      const companyRows = await prisma.insuranceCompany.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
      const nameMap = new Map(companyRows.map((c) => [c.id, c.name]))
      const formatList = (list: { companyId: number | null; policyNumber: string; ratio: number }[]) =>
        list.length === 0
          ? '無'
          : list
              .map((c) => `${c.companyId != null ? nameMap.get(c.companyId) ?? c.companyId : '未指定'} ${c.policyNumber}(${c.ratio}%)`)
              .join('、')
      coInsurerLogValues = { oldValue: formatList(existingCo), newValue: formatList(coInsurers) }
    }
  }

  // [2026/07/01] - Lisa - 保險公司承辦人改必填：編輯時若帶入此欄位不可為空
  if ('insuranceContact' in body && !String(body.insuranceContact ?? '').trim()) {
    return NextResponse.json({ success: false, error: '保險公司承辦人必填' }, { status: 400 })
  }

  // 欄位變更比對 + 寫 log（FR-77）
  const updates: Record<string, unknown> = {}
  const logs: { fieldName: string; oldValue: string | null; newValue: string | null }[] = []

  for (const [key, value] of Object.entries(body)) {
    // caseNumber 成案後不可修改；assignmentNotes 另做角色把關與回退比對（見下方）
    if (key === 'assignees' || key === 'coInsurers' || key === 'action' || key === 'cancelReason' || key === 'caseNumber' || key === 'assignmentNotes') continue
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

  // [2026/07/28] - Lisa - 交辦事項：僅特定角色可改；比對基準為「Case 值 → 派案池原值」，
  // 未實際變更則不寫入、不寫 log（避免舊案第一次儲存就產生假異動）
  if ('assignmentNotes' in body) {
    const next = String(body.assignmentNotes ?? '').trim()
    const current = await currentAssignmentNotes(existing)
    if (next !== current) {
      if (!canEditAssignmentNotes(session, existing)) {
        return NextResponse.json({ success: false, error: '無權限修改交辦事項' }, { status: 403 })
      }
      updates.assignmentNotes = next
      logs.push({ fieldName: '交辦事項', oldValue: current || null, newValue: next || null })
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
          oldValue: assigneeLogValues?.oldValue || null,
          newValue: assigneeLogValues?.newValue || null,
          logType: 'edit',
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
          oldValue: coInsurerLogValues?.oldValue || null,
          newValue: coInsurerLogValues?.newValue || null,
          logType: 'edit',
        },
      })
    }
  })

  const updated = await prisma.case.findUnique({ where: { id } })
  return NextResponse.json({ success: true, data: updated })
}

// [2026/07/31] - Lisa - 銷案案件刪除（案件查詢作業）可刪除角色：
// 部門主管（限本部門）／行政人員（有部門限本部門、無部門全公司）／系統管理員（全公司）。
// 刻意不含執行副總（vp）—— 刪除定位為業務／行政作業，故不沿用 canDispatch()（其含 vp）。
const DELETE_CANCELLED_ROLES = ['dept_manager', 'admin_staff', 'sysadmin']

function canDeleteCancelled(
  session: { role: string; departmentId: number | null },
  c: { departmentId: number },
): boolean {
  if (!DELETE_CANCELLED_ROLES.includes(session.role)) return false
  if (session.role === 'sysadmin') return true
  if (session.role === 'dept_manager') return session.departmentId === c.departmentId
  // 行政人員：有部門限本部門、無部門視為全公司（比照 canEditAssignmentNotes / fixCloseDate）
  return session.departmentId == null || session.departmentId === c.departmentId
}

// 刪除案件（兩條業務路徑，權限與行為皆不同）：
//  1) 未決 → 派案池刪除（既有行為，不變）：連同關聯紀錄一併硬刪、不封存。
//     注意：公證編號序號（case_number_seq）採遞增不回補，刪除已配號案件會造成公證編號跳號。
//  2) 銷案 → [2026/07/31] - Lisa - 案件查詢刪除：Case 本體與十張關聯表（含派案紀錄）快照寫入
//     deleted_cases 後才實刪；派案紀錄改記 status='已刪除' 以保留派案量統計；發信紀錄加註
//     「（案件已刪除）」；實刪後重算序號計數器，讓釋出的公證編號可經人工填號重用。詳見 lib/caseArchive。
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const id = parseInt(params.id)
  const c = await prisma.case.findUnique({ where: { id } })
  if (!c) return NextResponse.json({ success: false, error: '找不到案件' }, { status: 404 })

  // ── 銷案案件刪除（封存後實刪）────────────────────────────────────────────
  if (c.status === '銷案') {
    if (!canDeleteCancelled(session, c)) {
      return NextResponse.json({ success: false, error: '無權限刪除本案' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const deleteReason = String((body as Record<string, unknown>).deleteReason ?? '').trim()
    if (!deleteReason) {
      return NextResponse.json({ success: false, error: '刪除原因必填' }, { status: 400 })
    }

    // 審核中文件不可刪除（比照撤案防護；避免審核佇列殘留指向已刪案件的項目）
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
        { success: false, error: `以下文件審核中，無法刪除：${docs.join('、')}` },
        { status: 409 },
      )
    }

    // 已有結算紀錄者不可刪除：SettlementSplit 連動年度業績目標與績效統計，
    // 刪除等同追溯調整他人業績數字，須先由結算作業處理後再刪。
    const settlement = await prisma.settlement.findUnique({ where: { caseId: id }, select: { id: true } })
    if (settlement) {
      return NextResponse.json(
        { success: false, error: '本案已有結算紀錄（影響業績統計），無法刪除；請先移除結算資料' },
        { status: 409 },
      )
    }

    try {
      // timeout 放寬：封存需讀寫十張關聯表，遠端 DB 下預設 5 秒交易時限偏緊
      const result = await prisma.$transaction(
        (tx) => archiveAndDeleteCase(tx, id, { id: parseInt(session.sub), name: session.name }, deleteReason),
        { timeout: 20000, maxWait: 10000 },
      )
      return NextResponse.json({ success: true, data: result })
    } catch (e) {
      console.error('[case delete] 銷案案件刪除失敗：', e)
      return NextResponse.json({ success: false, error: '刪除失敗，請稍後再試' }, { status: 500 })
    }
  }

  // ── 派案池刪除（未決案件；既有行為）──────────────────────────────────────
  if (!canDispatch(session.role) && session.role !== 'sysadmin') {
    return NextResponse.json({ success: false, error: '無權限刪除' }, { status: 403 })
  }
  // 已決案件含結算等紀錄，不可刪除
  if (c.status !== '未決') {
    return NextResponse.json({ success: false, error: '已決案件不可刪除' }, { status: 409 })
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
