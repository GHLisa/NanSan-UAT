import type { Prisma } from '@prisma/client'
import { deriveSeqKey, recomputeSeq } from '@/lib/caseNumber'

// [2026/07/31] - Lisa - 案件刪除封存：案件查詢刪除「銷案」案件時，先把 Case 本體與十張關聯表
// 完整快照寫入 deleted_cases，再依外鍵相依序實刪，確保查詢／報表統計完全不計入亦不可查。
//
// 設計要點（與 FSD 決議一致）：
//  1) 搬表而非 isDeleted 旗標：全站 68 處 prisma.case.* 查詢（含 12 個報表／匯出端點）毋須加過濾條件，
//     不可能漏改；資料不在 cases 表裡就是查不到。
//  2) 派案紀錄採「標記」而非實刪：DispatchQueue 改記 status='已刪除' 並一併快照，保留保司派案量統計，
//     派案池畫面以 status 排除。因未實刪 DispatchQueue，Case→DispatchQueue 的 FK 亦無刪除順序問題。
//  3) MailLog / MailEventQueue 只在 caseNumber 快照附加「（案件已刪除）」標記，caseId 保留不清空：
//     兩表本就不設 FK，且 cases.id 為 autoincrement 永不重用、DeletedCase 亦沿用原 id，
//     因此 caseId 在刪除後仍是指向 deleted_cases.id 的有效指標，保留比清空更有稽核價值。
//     注意：發信紀錄查詢用 contains 比對（app/api/admin/mail-logs/route.ts），附加標記的效果是
//     「肉眼可辨識」而非「搜不到」—— 該頁僅 sysadmin 可查，屬稽核工具，不在「不可查」需求範圍內。
//  4) 編號釋出：實刪後於同一交易內呼叫 recomputeSeq()，刪最後一號則計數器自動退回、刪中間號為 no-op
//     （中間空號由行政人員於建案時人工填號回收）。自動取號邏輯完全不動。

/** 附加於 MailLog / MailEventQueue caseNumber 快照的標記 */
export const DELETED_CASE_MARK = '（案件已刪除）'

/** 派案紀錄封存後的狀態值（派案池查詢須排除此狀態） */
export const DISPATCH_DELETED_STATUS = '已刪除'

/**
 * 轉為可寫入 Prisma Json 欄位的值：BigInt → 字串、Date → ISO 字串。
 * Case 的金額欄位為 BigInt（estimatedAmount / coverageLimit / deductible / adjustmentAmount /
 * salvageValue / finalAmount），JSON.stringify 與 Prisma Json 皆無法直接處理，必須先轉換。
 */
function toJsonSafe(value: unknown): Prisma.InputJsonValue {
  const convert = (v: unknown): unknown => {
    if (v === null || v === undefined) return null
    if (typeof v === 'bigint') return v.toString()
    if (v instanceof Date) return v.toISOString()
    if (Array.isArray(v)) return v.map(convert)
    if (typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = convert(val)
      return out
    }
    return v
  }
  return convert(value) as Prisma.InputJsonValue
}

export interface ArchiveResult {
  caseNumber: string
  dispatchMarked: boolean
  mailLogsMarked: number
  mailEventsMarked: number
  recomputed: { seqKey: string; nextSeq: number } | null
}

/**
 * 封存並實刪案件。**必須在 prisma.$transaction 內呼叫**（交易失敗時封存與實刪一併回滾）。
 * 呼叫端負責權限與可刪條件（狀態、審核中文件、結算紀錄）檢核。
 */
export async function archiveAndDeleteCase(
  tx: Prisma.TransactionClient,
  caseId: number,
  operator: { id: number; name: string },
  deleteReason: string,
): Promise<ArchiveResult> {
  // ── 1) 載入案件本體（含部門／保司名稱快照，與推導 seqKey 所需的編號規則來源）────────
  const c = await tx.case.findUnique({
    where: { id: caseId },
    include: {
      department: {
        select: { name: true, caseNoCode: true, code: true, region: { select: { caseNoCode: true } } },
      },
      insuranceCompany: { select: { name: true } },
    },
  })
  if (!c) throw new Error('找不到案件')

  const { department, insuranceCompany, ...caseFields } = c
  // seqKey 推導所需的編號規則須在實刪前取得（刪除後撈不到部門）
  const caseNoCode = department.caseNoCode || department.code
  const regionCode = department.region.caseNoCode ?? ''
  const seqInfo = deriveSeqKey(c.caseNumber, caseNoCode, regionCode)

  // ── 2) 載入十張關聯表資料（Prisma 互動式交易共用單一連線，逐筆 await 不併發）──────────
  const coInsurers = await tx.caseCoInsurer.findMany({ where: { caseId } })
  const assignments = await tx.caseAssignment.findMany({ where: { caseId } })
  const progress = await tx.caseProgress.findMany({ where: { caseId } })
  const caseNotes = await tx.caseNote.findMany({ where: { caseId } })
  const logs = await tx.caseLog.findMany({ where: { caseId } })
  const reviews = await tx.caseReview.findMany({ where: { caseId } })
  const settlements = await tx.settlement.findMany({ where: { caseId } })
  const splits = await tx.settlementSplit.findMany({ where: { settlement: { caseId } } })
  const notifications = await tx.notification.findMany({ where: { caseId } })
  const dispatchEntry = c.dispatchEntryId
    ? await tx.dispatchQueue.findUnique({ where: { id: c.dispatchEntryId } })
    : null

  // ── 3) 寫入封存表（detailSnapshot 的 key 沿用各表 @@map 名稱）─────────────────────
  await tx.deletedCase.create({
    data: {
      id: c.id,                                   // 沿用原 cases.id，子表快照的 caseId 即可回溯至此
      caseNumber: c.caseNumber,
      insuredName: c.insuredName,
      departmentId: c.departmentId,
      departmentName: department.name,
      insuranceCompanyName: insuranceCompany.name,
      status: c.status,
      commissionDate: c.commissionDate,
      closeDate: c.closeDate,
      caseSnapshot: toJsonSafe(caseFields),
      detailSnapshot: toJsonSafe({
        case_co_insurers: coInsurers,
        case_assignments: assignments,
        case_progress: progress,
        case_notes: caseNotes,
        case_logs: logs,
        case_reviews: reviews,
        settlements,
        settlement_splits: splits,
        notifications,
        dispatch_queue: dispatchEntry ? [dispatchEntry] : [],
      }),
      deletedById: operator.id,
      deletedByName: operator.name,
      deleteReason,
    },
  })

  // ── 4) 發信紀錄標記（caseId 保留；已標記者不重複附加）──────────────────────────────
  const markedNumber = `${c.caseNumber}${DELETED_CASE_MARK}`
  const mailLogs = await tx.mailLog.updateMany({
    where: { caseId, NOT: { caseNumber: { contains: DELETED_CASE_MARK } } },
    data: { caseNumber: markedNumber },
  })
  const mailEvents = await tx.mailEventQueue.updateMany({
    where: { caseId, NOT: { caseNumber: { contains: DELETED_CASE_MARK } } },
    data: { caseNumber: markedNumber },
  })

  // ── 5) 派案紀錄改記「已刪除」（折衷方案：不實刪，保留保司派案量統計）────────────────
  let dispatchMarked = false
  if (c.dispatchEntryId) {
    await tx.dispatchQueue.update({
      where: { id: c.dispatchEntryId },
      data: { status: DISPATCH_DELETED_STATUS },
    })
    dispatchMarked = true
  }

  // ── 6) 依外鍵相依序實刪子表與案件（Case 關聯未設 onDelete cascade）────────────────
  //     settlement_splits 須先於 case_assignments（其 assignmentId 參照 CaseAssignment）
  await tx.settlementSplit.deleteMany({ where: { settlement: { caseId } } })
  await tx.settlement.deleteMany({ where: { caseId } })
  await tx.notification.deleteMany({ where: { caseId } })
  await tx.caseReview.deleteMany({ where: { caseId } })
  await tx.caseLog.deleteMany({ where: { caseId } })
  await tx.caseNote.deleteMany({ where: { caseId } })
  await tx.caseProgress.deleteMany({ where: { caseId } })
  await tx.caseAssignment.deleteMany({ where: { caseId } })
  await tx.caseCoInsurer.deleteMany({ where: { caseId } })
  await tx.case.delete({ where: { id: caseId } })

  // ── 7) 重算序號計數器（**必須在實刪之後**，否則被刪案件仍計入 maxSeq）────────────────
  //     非自動格式的人工編號 deriveSeqKey 回傳 null，該號不屬任何計數器群組，跳過重算。
  const recomputed = seqInfo
    ? await recomputeSeq(tx, seqInfo.seqKey, caseNoCode, regionCode, seqInfo.year)
    : null

  return {
    caseNumber: c.caseNumber,
    dispatchMarked,
    mailLogsMarked: mailLogs.count,
    mailEventsMarked: mailEvents.count,
    recomputed,
  }
}
