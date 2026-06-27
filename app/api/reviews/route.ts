import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { getApprovalFlow, INTERIM_DOC_TYPES, STAGE_DOC_TYPES, laterStage } from '@/lib/approvalFlow'
import { buildReviewWhere, type ReviewTab } from '@/lib/reviewScope'
import { mailReviewSubmitted } from '@/lib/caseMail'
import { reviewPendingNotification } from '@/lib/caseNotify'

// ── DB 部門代碼 → approvalFlow 分類代碼對照 ──────────────────────────────
// DB departments.code（TPE-ENG…）↔ approvalFlow DEPT_CATEGORY（NL / KL…）
const DEPT_CODE_MAP: Record<string, string> = {
  'TPE-ENG': 'NL',
  'TPE-LIA': 'NB',
  'TPE-FIRE': 'NF',
  'KHH-ENG': 'KL',
  'KHH-LIA': 'KB',
  'TXG-ENG': 'CL',
}

// 高雄工程部（三關卡加簽審核）DB 部門代碼（seed v3.0 起為 KL，保留舊代碼相容）
const KHH_ENG_DEPT_CODES = ['KL', 'KHH-ENG']

const INTERIM_FEE_TYPE = '追加預估公證費'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const tab: ReviewTab = searchParams.get('tab') === 'pendingVP' ? 'pendingVP' : 'pending'

  // 角色可見範圍 + Tab 篩選（與 /api/badge-counts 共用，見 lib/reviewScope）
  const where = buildReviewWhere(session, tab)

  const reviews = await prisma.caseReview.findMany({
    where,
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

// ── 送審 body 契約（案件詳情頁工程師依此呼叫）────────────────────────────
const SubmitReviewSchema = z.object({
  caseId: z.number(),
  documentType: z.string(),
  submissionNotes: z.string().optional(),
  checkedDocuments: z.array(z.string()).optional(),
  interimTypes: z.array(z.string()).optional(),
  interimAmount: z.number().nullable().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  let body: z.infer<typeof SubmitReviewSchema>
  try {
    body = SubmitReviewSchema.parse(await req.json())
  } catch {
    return NextResponse.json({ success: false, error: '送審資料格式錯誤' }, { status: 400 })
  }

  const empId = parseInt(session.sub)

  // ── 查案件（含部門代碼、估計金額、特殊案件旗標、承辦人指派）─────────────
  const caseData = await prisma.case.findUnique({
    where: { id: body.caseId },
    select: {
      id: true,
      caseNumber: true,
      status: true,
      currentStage: true,
      departmentId: true,
      estimatedAmount: true,
      estimatedFee: true,
      actualFee: true, // [2026/06/18] - Lisa - Issue #8 追加公證費改加至實際公證費 - Start/end
      adjustmentAmount: true, // [2026/06/18] - Lisa - Issue #2 理算書面報告書送審前置檢查需用 - Start/end
      isSpecialCase: true,
      department: { select: { code: true } },
      assignments: { select: { employeeId: true } },
    },
  })
  if (!caseData) {
    return NextResponse.json({ success: false, error: '找不到案件' }, { status: 404 })
  }

  // ── (a) 承辦人驗證 + 案件狀態 ────────────────────────────────────────
  const isHandler = caseData.assignments.some(a => a.employeeId === empId)
  // [2026/06/18] - Lisa - 行政人員代為送審（非審核）：有部門限本部門、無部門全公司
  const isAdminProxy =
    session.role === 'admin_staff' && (session.departmentId == null || session.departmentId === caseData.departmentId)
  if (!isHandler && session.role !== 'sysadmin' && !isAdminProxy) {
    return NextResponse.json({ success: false, error: '僅該案承辦人或行政人員可送審' }, { status: 403 })
  }
  if (caseData.status !== '未決') {
    return NextResponse.json({ success: false, error: '案件非未決狀態，無法送審' }, { status: 409 })
  }

  // [2026/06/18] - Lisa - Issue #2 理算書面報告書送審前須填理算損失額（adjustmentAmount）- Start
  // 空白判定為 null（未填）；數值 0 視為已填
  if (body.documentType === '理算書面報告書' && caseData.adjustmentAmount == null) {
    return NextResponse.json(
      { success: false, error: '理算損失額不可為空白，請先填寫後再送審' },
      { status: 409 }
    )
  }
  // [2026/06/18] - Lisa - Issue #2 理算書面報告書送審前須填理算損失額 - end

  // ── (b) FR-36 重複送審防護（伺服端）──────────────────────────────────
  const dup = await prisma.caseReview.findFirst({
    where: {
      caseId: body.caseId,
      documentType: body.documentType,
      OR: [
        { reviewStatus: '待複核' },
        { midApprovalStatus: '待加簽審核' },
        { approvalStatus: '待執行副總閱' },
      ],
    },
    select: { id: true },
  })
  if (dup) {
    return NextResponse.json(
      { success: false, error: '該文件類型已有審核中紀錄，無法重複送審' },
      { status: 409 }
    )
  }

  // ── (c) FR-47/90 伺服端計算審核路由 ─────────────────────────────────
  const categoryCode = DEPT_CODE_MAP[caseData.department.code ?? ''] ?? caseData.department.code
  const flow = getApprovalFlow(
    categoryCode,
    body.documentType,
    caseData.estimatedAmount != null ? Number(caseData.estimatedAmount) : null,
    caseData.isSpecialCase
  )
  const requiresVP = flow.alwaysVP || flow.amountVP
  const requiresMidApproval = flow.needsMidApproval

  // reviewer = 該案部門 dept_manager
  const deptManager = await prisma.employeeRole.findFirst({
    where: { departmentId: caseData.departmentId, role: 'dept_manager' },
    select: { employeeId: true },
  })
  if (!deptManager) {
    return NextResponse.json({ success: false, error: '查無該部門主管，無法送審' }, { status: 409 })
  }
  const reviewerId = deptManager.employeeId

  // needsMidApproval → 動態查高雄工程部 dept_manager 作為加簽審核
  let midApproverId: number | null = null
  if (requiresMidApproval) {
    const khhMgr = await prisma.employeeRole.findFirst({
      where: { department: { code: { in: KHH_ENG_DEPT_CODES } }, role: 'dept_manager' },
      select: { employeeId: true },
    })
    if (!khhMgr) {
      return NextResponse.json({ success: false, error: '查無高雄工程部主管，無法建立三關卡審核' }, { status: 409 })
    }
    midApproverId = khhMgr.employeeId
  }

  // ── (d) FR-85/86 中間報告 ───────────────────────────────────────────
  const isInterim = INTERIM_DOC_TYPES.includes(body.documentType)
  const interimTypes = isInterim && body.interimTypes && body.interimTypes.length > 0
    ? body.interimTypes
    : null
  const interimAmount = isInterim ? (body.interimAmount ?? null) : null
  const addsFee =
    !!interimTypes &&
    interimTypes.includes(INTERIM_FEE_TYPE) &&
    (interimAmount ?? 0) > 0

  // ── 建立審核記錄（含追加公證費於同一 transaction）─────────────────────
  const result = await prisma.$transaction(async (tx) => {
    const review = await tx.caseReview.create({
      data: {
        caseId: body.caseId,
        documentType: body.documentType,
        submittedBy: empId,
        submissionNotes: body.submissionNotes ?? null,
        checkedDocuments: body.checkedDocuments ? JSON.stringify(body.checkedDocuments) : null,
        reviewerId,
        reviewStatus: '待複核',
        requiresVP,
        requiresMidApproval,
        // midApprovalStatus 初始 null：待主管複核通過後才進中間關卡
        midApproverId,
        interimTypes: interimTypes ? JSON.stringify(interimTypes) : null,
        interimAmount,
      },
    })

    // [2026/06/18] - Lisa - 方案2 重送即終結舊退回：同案同文件類型、進行中(recordStatus=null)的退回紀錄
    // 標記為「已重送」並以 supersededById 連結本次新紀錄，使狀態由資料直接表達 - Start
    await tx.caseReview.updateMany({
      where: {
        caseId: body.caseId,
        documentType: body.documentType,
        recordStatus: null,
        id: { not: review.id },
        OR: [{ reviewStatus: '退回' }, { midApprovalStatus: '退回' }, { approvalStatus: '退回' }],
      },
      data: { recordStatus: '已重送', supersededById: review.id },
    })
    // [2026/06/18] - Lisa - 方案2 重送即終結舊退回 - end

    // FR-59：送審即寫入一筆進度記錄，stage 依 STAGE_DOC_TYPES 反查文件所屬流程節點
    // （非 currentStage），與 demo CaseDetailPage 送審行為一致
    const progressStage =
      Object.entries(STAGE_DOC_TYPES).find(([, types]) => types.includes(body.documentType))?.[0]
      ?? caseData.currentStage
    await tx.caseProgress.create({
      data: {
        caseId: body.caseId,
        stage: progressStage,
        progressDate: new Date(),
        description: `送審：${body.documentType} (${session.name})`,
        createdBy: empId,
      },
    })

    // [2026/06/18] - Lisa - Issue #7 送審即推進 currentStage 至該文件節點（只前進不回退）- Start
    const advancedStage = laterStage(caseData.currentStage, progressStage)
    if (advancedStage !== caseData.currentStage) {
      await tx.case.update({
        where: { id: body.caseId },
        data: { currentStage: advancedStage },
      })
    }
    // [2026/06/18] - Lisa - Issue #7 送審即推進 currentStage - end

    // [2026/06/18] - Lisa - Issue #8 追加公證費改加至「實際公證費」(actualFee)，非預估 - Start
    // FR-85（v3.3 修訂）：中間報告追加公證費 → case.actualFee += interimAmount + caseLog
    if (addsFee) {
      const oldFee = caseData.actualFee ?? 0
      const newFee = oldFee + (interimAmount ?? 0)
      await tx.case.update({
        where: { id: body.caseId },
        data: { actualFee: newFee },
      })
      await tx.caseLog.create({
        data: {
          caseId: body.caseId,
          employeeId: empId,
          fieldName: 'actualFee',
          logType: 'interim_add',
          oldValue: String(oldFee),
          newValue: String(newFee),
          amount: interimAmount ?? 0,
        },
      })
    }
    // [2026/06/18] - Lisa - Issue #8 追加公證費改加至實際公證費 - end

    // [2026/06/24] - Lisa - 待審核通知：送審 → 通知第一關審核人（該部門主管），與成案同交易寫入
    await tx.notification.create({
      data: reviewPendingNotification(body.caseId, caseData.caseNumber, body.documentType, { employeeId: reviewerId }),
    })

    return review
  })

  // 立即通知（2）文件送審 → 當前審核人（該部門主管）；寄信失敗不影響送審結果
  await mailReviewSubmitted(body.caseId, caseData.caseNumber, body.documentType, reviewerId)

  return NextResponse.json({ success: true, data: { id: result.id } }, { status: 201 })
}
