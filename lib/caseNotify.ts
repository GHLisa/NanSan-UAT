import type { Prisma } from '@prisma/client'

// 站內通知（notifications 表）寫入資料建構器。
// 與 lib/caseMail.ts（email 通知）平行：caseMail 負責寄信、caseNotify 負責站內通知記錄。
//
// 觸達機制：notifications 採「角色 + 案件可視範圍」過濾（見 app/api/notifications GET），
// 並非指定 employeeId。targetRoles='handler' 搭配 handler scope（buildCaseScopeWhere＝
// assignments.some(自己)）即只會被該案「主辦＋協辦」的承辦人看到，不會打擾其他承辦人。

// [2026/06/24] - Lisa - 新增「派案通知」：案件成立並指派承辦人時寫入 notification，通知主辦與協辦
export function newAssignmentNotification(
  caseId: number,
  caseNumber: string,
  insuredName: string,
): Prisma.NotificationUncheckedCreateInput {
  return {
    type: 'case_assigned', // 對齊前端 TYPE_LABEL／TYPE_GROUP（顯示為「派案通知」）
    title: '新派案通知',
    message: `您有新承辦案件 ${caseNumber}（${insuredName}），請至系統查看並開始處理。`,
    caseId,
    targetRoles: 'handler',
    isRead: false,
  }
}

// [2026/06/24] - Lisa - 編輯模式新增/更換承辦人 → 通知當前全部承辦人（主辦＋協辦）
// 註：notifications 為角色+案件範圍過濾，無法只通知「新增者」；一筆通知即觸達該案目前全部承辦人。
export function assignmentChangedNotification(
  caseId: number,
  caseNumber: string,
  insuredName: string,
): Prisma.NotificationUncheckedCreateInput {
  return {
    type: 'case_assigned',
    title: '承辦人異動通知',
    message: `案件 ${caseNumber}（${insuredName}）承辦人已異動，請確認您的承辦狀態。`,
    caseId,
    targetRoles: 'handler',
    isRead: false,
  }
}

// [2026/06/24] - Lisa - 「待審核」通知：送審/簽核流程每次送件，通知該關卡審核人員。
// target 二擇一：{ employeeId } 指定收件人（待複核部門主管、加簽審核跨部門主管）；
//               { roles } 角色廣播（執行副總＝VP，範圍＝全公司，角色廣播即可觸達全部 VP）。
// type 'review_submitted' 對齊前端 TYPE_LABEL／TYPE_GROUP（顯示為「待審核」）。
export function reviewPendingNotification(
  caseId: number,
  caseNumber: string,
  documentType: string,
  target: { employeeId: number } | { roles: string },
  cascade = false,
): Prisma.NotificationUncheckedCreateInput {
  return {
    type: 'review_submitted',
    title: cascade ? '有文件進入您的審核關卡' : '有文件待您審核',
    message: `案件 ${caseNumber} ${documentType}，${cascade ? '已通過前一關卡' : '已送至您的審核關卡'}，請至系統進行審核。`,
    caseId,
    targetRoles: 'roles' in target ? target.roles : '',
    targetEmployeeId: 'employeeId' in target ? target.employeeId : null,
    isRead: false,
  }
}
