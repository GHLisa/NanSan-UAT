import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
// [2026/08/05] - Lisa - 新增 mailReviewApproved：終審核准（走完全部關卡）通知承辦人
import { mailReviewRejected, mailReviewCascade, mailReviewApproved, emailsByIds, vpEmails } from '@/lib/caseMail'
import { reviewPendingNotification } from '@/lib/caseNotify'
// [2026/08/05] - Lisa - 終審核准自動回填案件報告日期（節點2→初步報告日期、節點7→最終報告日期）
import { reportDateFieldOf } from '@/lib/reportStage'

const ActionSchema = z.object({
  // [2026/06/18] - Lisa - 方案1 新增 'abandon'（承辦人放棄被退回的送審）
  action: z.enum(['approve', 'reject', 'vp_approve', 'vp_reject', 'mid_approve', 'mid_reject', 'abandon']),
  remarks: z.string().optional(),
})

const INTERIM_FEE_TYPE = '追加預估公證費'
const REJECT_ACTIONS = ['reject', 'mid_reject', 'vp_reject']

function tryParseArray(s: string | null): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const id = parseInt(params.id)
  let body: z.infer<typeof ActionSchema>
  try {
    body = ActionSchema.parse(await req.json())
  } catch {
    return NextResponse.json({ success: false, error: '操作格式錯誤' }, { status: 400 })
  }
  const empId = parseInt(session.sub)
  const now = new Date()

  const review = await prisma.caseReview.findUnique({
    where: { id },
    include: {
      case: {
        select: {
          id: true, caseNumber: true, departmentId: true, estimatedFee: true, actualFee: true,
          // [2026/08/05] - Lisa - 自動回填前需確認欄位是否為空（已有值不覆寫）
          preliminaryReportDate: true, finalReportDate: true,
        },
      },
    },
  })
  if (!review) return NextResponse.json({ success: false, error: '找不到審核記錄' }, { status: 404 })

  // ── reject 類 remarks 必填 ────────────────────────────────────────────
  if (REJECT_ACTIONS.includes(body.action) && !body.remarks?.trim()) {
    return NextResponse.json({ success: false, error: '退回原因必填' }, { status: 400 })
  }

  const isSysadmin = session.role === 'sysadmin'

  // [2026/06/18] - Lisa - 方案1 放棄被退回的送審（文件層級終結，不重送即可離開待辦）- Start
  if (body.action === 'abandon') {
    if (review.recordStatus != null) {
      return NextResponse.json({ success: false, error: '此送審已結束（已重送或已放棄），無法再放棄' }, { status: 409 })
    }
    const isRejected =
      review.reviewStatus === '退回' || review.midApprovalStatus === '退回' || review.approvalStatus === '退回'
    if (!isRejected) {
      return NextResponse.json({ success: false, error: '僅可放棄「被退回」的送審' }, { status: 409 })
    }
    // 權限：該案承辦人（主辦/協辦）或系統管理員
    const assigned = await prisma.caseAssignment.findFirst({
      where: { caseId: review.case.id, employeeId: empId },
      select: { id: true },
    })
    if (!assigned && !isSysadmin) {
      return NextResponse.json({ success: false, error: '僅該案承辦人可放棄送審' }, { status: 403 })
    }
    await prisma.caseReview.update({ where: { id }, data: { recordStatus: '已放棄' } })
    return NextResponse.json({ success: true, data: { id } })
  }
  // [2026/06/18] - Lisa - 方案1 放棄被退回的送審 - end

  // ── FR-13/90 權限與狀態驗證 ───────────────────────────────────────────
  switch (body.action) {
    case 'approve':
    case 'reject': {
      if (session.role !== 'dept_manager' && !isSysadmin) {
        return NextResponse.json({ success: false, error: '僅部門主管可複核' }, { status: 403 })
      }
      if (review.reviewStatus !== '待複核') {
        return NextResponse.json({ success: false, error: '此記錄非待複核狀態' }, { status: 409 })
      }
      if (!isSysadmin && review.case.departmentId !== session.departmentId) {
        return NextResponse.json({ success: false, error: '僅可複核本部門案件' }, { status: 403 })
      }
      break
    }
    case 'mid_approve':
    case 'mid_reject': {
      if (review.midApproverId !== empId && !isSysadmin) {
        return NextResponse.json({ success: false, error: '僅指定之加簽審核人員可審核' }, { status: 403 })
      }
      if (review.midApprovalStatus !== '待加簽審核') {
        return NextResponse.json({ success: false, error: '此記錄非待加簽審核狀態' }, { status: 409 })
      }
      break
    }
    case 'vp_approve':
    case 'vp_reject': {
      if (session.role !== 'vp' && !isSysadmin) {
        return NextResponse.json({ success: false, error: '僅執行副總可審閱' }, { status: 403 })
      }
      if (review.approvalStatus !== '待執行副總閱') {
        return NextResponse.json({ success: false, error: '此記錄非待執行副總閱狀態' }, { status: 409 })
      }
      break
    }
  }

  let updateData: Record<string, unknown> = {}
  const isReject = REJECT_ACTIONS.includes(body.action)

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
        updateData.midApprovalStatus = '待加簽審核'
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
      // 加簽審核通過 → cascade 到執行副總閱
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

  // ── [2026/08/05] - Lisa - 終審核准自動回填案件報告日期 ────────────────────
  // 節點2（查勘初步報告書／初步預估試算表）→ 初步報告日期；節點7（結案報告書）→ 最終報告日期。
  // 「終審核准」＝本次動作讓該筆走完所需的全部關卡：
  //   - approve 且不需加簽、不需副總 → 當下即終審
  //   - vp_approve → 當下即終審
  //   - mid_approve 一律 cascade 至副總關卡，故非終審
  // 已有值不覆寫（保留人工／補登的原始日期），退回不寫，重送再核准時若已有值亦不動。
  const isTerminalApproval =
    (body.action === 'approve' && !review.requiresMidApproval && !review.requiresVP) ||
    body.action === 'vp_approve'
  const reportDateField = isTerminalApproval ? reportDateFieldOf(review.documentType) : null
  const shouldFillReportDate = !!reportDateField && review.case[reportDateField] == null
  const REPORT_DATE_LABEL: Record<'preliminaryReportDate' | 'finalReportDate', string> = {
    preliminaryReportDate: '初步報告日期',
    finalReportDate: '最終報告日期',
  }

  // ── FR-86 退件還原追加預估公證費 ──────────────────────────────────────
  const interimTypes = tryParseArray(review.interimTypes)
  const shouldRevertFee =
    isReject &&
    interimTypes.includes(INTERIM_FEE_TYPE) &&
    (review.interimAmount ?? 0) > 0 &&
    review.feeReversed === false

  await prisma.$transaction(async (tx) => {
    await tx.caseReview.update({
      where: { id },
      data: { ...updateData, ...(shouldRevertFee ? { feeReversed: true } : {}) },
    })

    if (shouldRevertFee) {
      // [2026/06/18] - Lisa - Issue #8 追加公證費改加至實際公證費，退回還原亦對 actualFee - Start
      const oldFee = review.case.actualFee ?? 0
      const newFee = Math.max(0, oldFee - (review.interimAmount ?? 0))
      await tx.case.update({
        where: { id: review.case.id },
        data: { actualFee: newFee },
      })
      await tx.caseLog.create({
        data: {
          caseId: review.case.id,
          employeeId: empId,
          fieldName: 'actualFee',
          logType: 'interim_revert',
          oldValue: String(oldFee),
          newValue: String(newFee),
          amount: review.interimAmount ?? 0,
        },
      })
      // [2026/06/18] - Lisa - Issue #8 追加公證費改加至實際公證費 - end
    }

    // [2026/08/05] - Lisa - 終審核准回填報告日期（含修改記錄，logType 'auto_fill' 以免被誤判為「送審後已修改」）
    if (reportDateField && shouldFillReportDate) {
      await tx.case.update({
        where: { id: review.case.id },
        data: { [reportDateField]: now },
      })
      await tx.caseLog.create({
        data: {
          caseId: review.case.id,
          employeeId: empId,
          fieldName: REPORT_DATE_LABEL[reportDateField],
          logType: 'auto_fill',
          oldValue: null,
          newValue: now.toISOString().slice(0, 10),
        },
      })
    }

    // ── FR-13 通知原送審人 ────────────────────────────────────────────
    const notif = buildNotification(body.action, review.case.caseNumber)
    if (notif) {
      await tx.notification.create({
        data: {
          type: notif.type,
          title: notif.title,
          message: notif.message,
          caseId: review.case.id,
          targetRoles: 'handler',
          isRead: false,
        },
      })
    }
  })

  // ── 立即通知（不影響上方交易結果）──────────────────────────────────────
  if (isReject) {
    // (3) 文件退回 → 主承辦人＋協辦人
    await mailReviewRejected(review.case.id, review.case.caseNumber, review.documentType, body.remarks)
  } else if (body.action === 'approve' && updateData.midApprovalStatus === '待加簽審核') {
    // (2) 主管複核通過、進入加簽審核關卡 → 通知加簽審核
    await mailReviewCascade(review.case.id, review.case.caseNumber, review.documentType, await emailsByIds([review.midApproverId]), review.mergedBilling)
    // [2026/06/24] - Lisa - 待審核通知：加簽審核人（跨部門，指定收件人觸達）
    if (review.midApproverId) {
      await prisma.notification.create({
        data: reviewPendingNotification(review.case.id, review.case.caseNumber, review.documentType, { employeeId: review.midApproverId }, true),
      })
    }
  } else if (
    (body.action === 'approve' || body.action === 'mid_approve') &&
    updateData.approvalStatus === '待執行副總閱'
  ) {
    // (2) 進入執行副總關卡 → 通知執行副總
    await mailReviewCascade(review.case.id, review.case.caseNumber, review.documentType, await vpEmails(), review.mergedBilling)
    // [2026/06/24] - Lisa - 待審核通知：執行副總（VP 範圍＝全公司，角色廣播觸達全部 VP）
    await prisma.notification.create({
      data: reviewPendingNotification(review.case.id, review.case.caseNumber, review.documentType, { roles: 'vp' }, true),
    })
  } else if (isTerminalApproval) {
    // [2026/08/05] - Lisa - (4) 終審核准（走完全部關卡）→ 主承辦人＋協辦人
    // 與上方 cascade 分支互斥：cascade 成立表示還有下一關（requiresMidApproval / requiresVP），
    // 必不為終審；mid_approve 一律 cascade 至副總關卡亦非終審。站內通知（交易內 review_approved）
    // 維持即時，本信走 mail_event_queue 於平日 08:00 / 16:00 彙整寄出。
    await mailReviewApproved(review.case.id, review.case.caseNumber, review.documentType, body.remarks, review.mergedBilling)
  }

  return NextResponse.json({ success: true, data: { id } })
}

// 依 action 產生給原送審人（handler）的通知；type 沿用 seed 既有值域
function buildNotification(
  action: string,
  caseNumber: string
): { type: string; title: string; message: string } | null {
  switch (action) {
    case 'approve':
      return { type: 'review_approved', title: '文件複核完成', message: `案件 ${caseNumber} 文件已通過主管複核` }
    case 'mid_approve':
      return { type: 'review_approved', title: '加簽審核完成', message: `案件 ${caseNumber} 文件已通過加簽審核` }
    case 'vp_approve':
      return { type: 'review_approved', title: '文件審核完成', message: `案件 ${caseNumber} 文件已經執行副總核准` }
    case 'reject':
    case 'mid_reject':
    case 'vp_reject':
      return { type: 'review_rejected', title: '文件遭退回', message: `案件 ${caseNumber} 送審文件已被退回，請查看退回原因並修正` }
    default:
      return null
  }
}
