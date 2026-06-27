import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildNotificationVisibilityWhere } from '@/lib/caseScope'
import { buildReviewWhere, defaultReviewTab } from '@/lib/reviewScope'

/**
 * FR-38 / FR-54 導覽列 badge 計數
 * 回傳：
 *   dispatchCount = 待建案（dispatchQueue status='待取件'）＋ 待指派（cases status='未決' 且無承辦人）
 *   myCaseCount   = 登入者未決案件數（assignments some employeeId=自己 且 case status='未決'）
 *   reviewCount   = 登入者文件審核未審件數（預設 Tab 件數，與 /api/reviews 共用 lib/reviewScope）
 *   unreadCount   = 登入者可視範圍內的未讀通知數（FR-84，原由 /api/notifications 計算）
 *
 * 部門範圍：一般角色僅本部門（依 session.departmentId）；vp / sysadmin 為全公司。
 *
 * 效能：未讀通知數併入本端點，使導覽列每次更新僅需一趟往返（原為 badge + notifications 兩趟，
 * 對遠端 DB 而言每趟約 200ms，合併後減半）。
 */
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  }

  try {
    const empId = parseInt(session.sub)
    // FR-05（v3.2）：行政人員不限部門（與派案池 /api/dispatch 一致），badge 計數涵蓋全公司待建案/待指派
    const canSeeAll = session.role === 'vp' || session.role === 'sysadmin' || session.role === 'admin_staff'
    const deptId = session.departmentId
    const deptFilter = !canSeeAll && deptId ? deptId : undefined

    // 通知可視範圍（FR-84）：指定收件人(本人) 或 角色廣播+可視案件範圍
    const notificationWhere = await buildNotificationVisibilityWhere(session)

    const [pendingQueueCount, unassignedCaseCount, myCaseCount, reviewCount, unreadCount] = await Promise.all([
      // 待建案：dispatch_queue 待取件，本部門（vp/sysadmin 全公司）
      prisma.dispatchQueue.count({
        where: {
          status: '待取件',
          ...(deptFilter ? { assignedDepartmentId: deptFilter } : {}),
        },
      }),
      // 待指派：未決且尚無承辦人的案件，本部門（vp/sysadmin 全公司）
      prisma.case.count({
        where: {
          status: '未決',
          assignments: { none: {} },
          ...(deptFilter ? { departmentId: deptFilter } : {}),
        },
      }),
      // 我的案件：登入者承辦且未決
      prisma.case.count({
        where: {
          status: '未決',
          assignments: { some: { employeeId: empId } },
        },
      }),
      // 文件審核未審件數：依角色取預設 Tab（vp→待執行副總閱，其餘→複核待辦）
      prisma.caseReview.count({
        where: buildReviewWhere(session, defaultReviewTab(session.role)),
      }),
      // 未讀通知數：僅算可視範圍（取代前端撈 100 筆再 filter）
      prisma.notification.count({
        where: { isRead: false, ...notificationWhere },
      }),
    ])

    return NextResponse.json({
      success: true,
      data: {
        dispatchCount: pendingQueueCount + unassignedCaseCount,
        myCaseCount,
        reviewCount,
        unreadCount,
      },
    })
  } catch (e) {
    console.error('[badge-counts]', e)
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 })
  }
}
