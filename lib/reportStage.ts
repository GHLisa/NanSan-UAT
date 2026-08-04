// ── 報告完成判定共用模組 ─────────────────────────────────────────────────
// [2026/08/05] - Lisa - 「初步報告是否完成」的單一事實來源。
//
// 背景：SLA 燈號原本只看 Case.preliminaryReportDate，但該欄位在系統上沒有任何寫入
// 入口（無 UI、審核核准也不回填），實際資料 100% 為 null，導致燈號退化成「只看委託
// 天數」——所有未決案件過 14 天一律黃燈。
//
// 對策分兩段（本檔為第一段）：
//   1. 判定改多來源：初報日期 有值 ／ 初報文件已終審核准 ／ 案件階段已越過「初步報告」
//      三者任一成立即視為完成，歷史案件不必回填也能立刻正確。
//   2. 新案自動回填：初報文件（節點2）、正式結案報告（節點7）終審核准時寫回日期欄位
//      （見 app/api/reviews/[id]/route.ts）。
//
// 判定函式提供「JS 述詞」與「Prisma where 片段」兩種形式，兩者規則必須一致：
// 前者供已撈出資料的列渲染，後者供清單／預警的資料庫篩選。

import { CASE_STAGES, STAGE_DOC_TYPES } from '@/lib/approvalFlow'
import type { Prisma } from '@prisma/client'

// 節點2「初步報告」/ 節點6「理算說明/協商」/ 節點7「正式結案報告」/ 節點8「請款單填寫」對應文件類型
export const PRELIM_DOC_TYPES = STAGE_DOC_TYPES['初步報告']          // 查勘初步報告書、初步預估試算表
export const ADJUST_DOC_TYPES = STAGE_DOC_TYPES['理算說明/協商']      // 理算書面報告書
export const FINAL_REPORT_DOC_TYPES = STAGE_DOC_TYPES['正式結案報告'] // 結案報告書
export const BILLING_DOC_TYPES = STAGE_DOC_TYPES['請款單填寫']       // 公證費 DEBIT NOTE

// ── 期限天數（FSD：接案後 14 天內完成初報；節點6 核定後 60 天內完成結報；
//    結報＋請款核准後 14 天內結案）────────────────────────────────────────
// [2026/08/05] - Lisa - 天數集中於此，日後客戶要調整只需改這裡
export const PRELIM_REMINDER_DAYS = 14
export const CLOSING_REMINDER_DAYS = 14
export const CLOSING_REPORT_DEADLINE_DAYS = 60

// [2026/08/05] - Lisa - 客戶決議取消逾期緩衝：待辦事項只顯示「期限內」（D+0~14），
// 一逾期即由 SLA 預警的「初報逾期」段接手，一件事只出現在一個地方。

const PRELIM_STAGE = '初步報告'
// 「初步報告」之後的節點：currentStage 落在這些節點即代表初報早已完成
export const STAGES_AFTER_PRELIM = CASE_STAGES.slice(CASE_STAGES.indexOf(PRELIM_STAGE) + 1)

export function isPastPrelimStage(stage: string): boolean {
  return STAGES_AFTER_PRELIM.includes(stage)
}

/**
 * 送審紀錄的關卡欄位（依查詢 select 而定，未取的欄位以 undefined 表示）。
 * requiresVP / requiresMidApproval 未 select 時視為 false（不檢查該關卡），
 * 呼叫端若要精確判定終審核准，務必一併 select 這兩個旗標。
 */
export interface ReviewGateLike {
  documentType: string
  reviewStatus: string
  midApprovalStatus?: string | null
  approvalStatus?: string | null
  requiresVP?: boolean
  requiresMidApproval?: boolean
  recordStatus?: string | null
}

/** 終審核准＝走完該筆所需的全部關卡（主管複核＋需加簽者＋需副總者），且未被重送/放棄取代 */
export function isFinalApproved(r: ReviewGateLike): boolean {
  if (r.recordStatus != null) return false
  if (r.reviewStatus !== '已核准') return false
  if (r.requiresMidApproval && r.midApprovalStatus !== '已核准') return false
  if (r.requiresVP && r.approvalStatus !== '已核准') return false
  return true
}

/** 終審核准的 Prisma 條件（與 isFinalApproved 同規則） */
export function finalApprovedReviewWhere(docTypes: string[]): Prisma.CaseReviewWhereInput {
  return {
    documentType: { in: docTypes },
    recordStatus: null,
    reviewStatus: '已核准',
    AND: [
      { OR: [{ requiresMidApproval: false }, { midApprovalStatus: '已核准' }] },
      { OR: [{ requiresVP: false }, { approvalStatus: '已核准' }] },
    ],
  }
}

/**
 * 初步報告是否完成（多來源判定）。
 * reviews 省略時僅以日期欄位與案件階段判定（呼叫端另以 caseId 集合補足者適用）。
 */
export function isPrelimDone(c: {
  preliminaryReportDate?: Date | string | null
  currentStage: string
  reviews?: ReviewGateLike[]
}): boolean {
  if (c.preliminaryReportDate) return true
  if (isPastPrelimStage(c.currentStage)) return true
  return (c.reviews ?? []).some(r => PRELIM_DOC_TYPES.includes(r.documentType) && isFinalApproved(r))
}

/** 初步報告「未完成」的 Prisma 條件（SLA 黃/紅燈篩選用，與 isPrelimDone 互為反面） */
export function prelimPendingWhere(): Prisma.CaseWhereInput {
  return {
    preliminaryReportDate: null,
    currentStage: { notIn: STAGES_AFTER_PRELIM },
    reviews: { none: finalApprovedReviewWhere(PRELIM_DOC_TYPES) },
  }
}

/** 含關卡時間戳的送審紀錄（結案提醒需知道「哪一天完成終審」） */
export interface ReviewTimeLike extends ReviewGateLike {
  mergedBilling?: boolean
  reviewedAt?: Date | null
  midApprovedAt?: Date | null
  approvedAt?: Date | null
}

/** 終審核准的時間點（走完最後一關的時間）；未達終審核准回傳 null */
export function finalApprovedAt(r: ReviewTimeLike): Date | null {
  if (!isFinalApproved(r)) return null
  if (r.requiresVP) return r.approvedAt ?? r.midApprovedAt ?? r.reviewedAt ?? null
  if (r.requiresMidApproval) return r.midApprovedAt ?? r.reviewedAt ?? null
  return r.reviewedAt ?? null
}

/**
 * 節點7「正式結案報告」＋節點8「請款單填寫」是否皆已終審核准。
 * 回傳兩者中較晚的核准時間（＝可以開始結案的起算日），任一未完成則為 null。
 * 合併送審（結案報告書隨附公證費 DEBIT NOTE）之單筆紀錄同時滿足兩個節點。
 */
export function closingApprovedAt(reviews: ReviewTimeLike[]): Date | null {
  let node7: Date | null = null
  let node8: Date | null = null
  for (const r of reviews) {
    const at = finalApprovedAt(r)
    if (!at) continue
    if (FINAL_REPORT_DOC_TYPES.includes(r.documentType)) {
      if (!node7 || at > node7) node7 = at
      if (r.mergedBilling && (!node8 || at > node8)) node8 = at
    } else if (BILLING_DOC_TYPES.includes(r.documentType)) {
      if (!node8 || at > node8) node8 = at
    }
  }
  if (!node7 || !node8) return null
  return node7 > node8 ? node7 : node8
}

/**
 * 節點6「理算說明/協商」核定時間＝理算書面報告書**最新一次**終審核准的時間。
 * [2026/08/05] - Lisa - 客戶決議：若核定後又退回重送、再次核准，起算日以最新一次為準。
 */
export function adjustApprovedAt(reviews: ReviewTimeLike[]): Date | null {
  let latest: Date | null = null
  for (const r of reviews) {
    if (!ADJUST_DOC_TYPES.includes(r.documentType)) continue
    const at = finalApprovedAt(r)
    if (at && (!latest || at > latest)) latest = at
  }
  return latest
}

/**
 * 「節點6 已核定、節點7 結案報告尚未完成」的 Prisma 條件（SLA 結報期限預警用）。
 * 起算日與剩餘天數需另以 adjustApprovedAt() 於程式端計算。
 */
export function closingReportPendingWhere(): Prisma.CaseWhereInput {
  return {
    reviews: {
      some: finalApprovedReviewWhere(ADJUST_DOC_TYPES),
      none: finalApprovedReviewWhere(FINAL_REPORT_DOC_TYPES),
    },
  }
}

/**
 * 文件類型 → 終審核准時應自動回填的案件日期欄位（節點2 → 初步報告日期、節點7 → 最終報告日期）。
 * 其餘文件類型回傳 null（不回填）。
 */
export function reportDateFieldOf(documentType: string): 'preliminaryReportDate' | 'finalReportDate' | null {
  if (PRELIM_DOC_TYPES.includes(documentType)) return 'preliminaryReportDate'
  if (FINAL_REPORT_DOC_TYPES.includes(documentType)) return 'finalReportDate'
  return null
}
