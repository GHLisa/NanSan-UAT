import { NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import dayjs from 'dayjs'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const deptWhere = canViewAllDepts(session.role) || !session.departmentId
    ? {}
    : { departmentId: session.departmentId }

  const empId = parseInt(session.sub)

  const [
    totalCases,
    closedCases,
    pendingReviews,
    unreadNotifications,
    stageDistribution,
    slaWarnings,
    myCaseCount,
    recentCases,
  ] = await Promise.all([
    prisma.case.count({ where: { ...deptWhere, status: '未決' } }),
    prisma.case.count({ where: { ...deptWhere, status: '已決' } }),
    prisma.caseReview.count({ where: { reviewerId: empId, reviewStatus: '待複核' } }),
    prisma.notification.count({ where: { isRead: false } }),
    prisma.case.groupBy({
      by: ['currentStage'],
      where: { ...deptWhere, status: '未決' },
      _count: { id: true },
    }),
    prisma.case.findMany({
      where: {
        ...deptWhere,
        status: '未決',
        preliminaryReportDate: null,
        commissionDate: { lt: dayjs().subtract(14, 'day').toDate() },
      },
      select: {
        id: true, caseNumber: true, insuredName: true,
        commissionDate: true, currentStage: true,
        department: { select: { name: true } },
      },
      orderBy: { commissionDate: 'asc' },
      take: 10,
    }),
    (session.role === 'handler' || session.role === 'admin_staff')
      ? prisma.caseAssignment.count({ where: { employeeId: empId, case: { status: '未決' } } })
      : Promise.resolve(0),
    prisma.case.findMany({
      where: deptWhere,
      select: { id: true, caseNumber: true, insuredName: true, status: true, currentStage: true, commissionDate: true },
      orderBy: { commissionDate: 'desc' },
      take: 5,
    }),
  ])

  return NextResponse.json({
    success: true,
    data: {
      kpi: {
        totalCases,
        closedCases,
        pendingReviews,
        unreadNotifications,
        myCaseCount,
      },
      stageDistribution: stageDistribution.map((s) => ({ stage: s.currentStage, count: s._count.id })),
      slaWarnings: slaWarnings.map((c) => ({
        id: c.id,
        caseNumber: c.caseNumber,
        insuredName: c.insuredName,
        departmentName: c.department.name,
        commissionDate: c.commissionDate.toISOString(),
        currentStage: c.currentStage,
        daysSince: dayjs().diff(dayjs(c.commissionDate), 'day'),
      })),
      recentCases: recentCases.map((c) => ({
        ...c,
        commissionDate: c.commissionDate.toISOString(),
      })),
    },
  })
}
