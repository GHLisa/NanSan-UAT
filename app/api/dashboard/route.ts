import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import dayjs from 'dayjs'

// SLA status: red = >30d no prelim OR >90d open; yellow = >14d no prelim
function getSlaStatus(commissionDate: Date, preliminaryReportDate: Date | null, status: string): 'red' | 'yellow' | 'normal' {
  if (status !== '未決') return 'normal'
  const daysSince = dayjs().diff(dayjs(commissionDate), 'day')
  if (!preliminaryReportDate && daysSince >= 30) return 'red'
  if (daysSince >= 90) return 'red'
  if (!preliminaryReportDate && daysSince >= 14) return 'yellow'
  return 'normal'
}

// Build department/assignment scope where clause based on role
function buildCaseWhere(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return {}
  const { role, departmentId } = session
  if (role === 'vp' || role === 'sysadmin' || !departmentId) return {}
  if (role === 'handler' || role === 'admin_staff') {
    return {
      departmentId,
      assignments: { some: { employeeId: parseInt(session.sub) } },
    }
  }
  // team_lead / dept_manager: whole department
  return { departmentId }
}

function getCaseScope(session: Awaited<ReturnType<typeof getSession>>): string {
  if (!session) return '全公司'
  const { role, departmentName, teamGroup, name } = session
  if (role === 'vp' || role === 'sysadmin') return '全公司'
  if (role === 'handler' || role === 'admin_staff') return name
  if (role === 'team_lead' && teamGroup) return `${departmentName ?? ''} ${teamGroup}`
  return departmentName ?? '本部門'
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const empId = parseInt(session.sub)
  const caseWhere = buildCaseWhere(session)
  const caseScope = getCaseScope(session)
  const currentYear = dayjs().year()
  const today = dayjs()

  // ── Pending count (role-based) ─────────────────────────────────────────
  let pendingCount = 0
  let pendingLabel = '待辦'
  if (session.role === 'handler') {
    pendingCount = await prisma.caseReview.count({ where: { submittedBy: empId, reviewStatus: '退回' } })
    pendingLabel = '退回待修'
  } else if (session.role === 'team_lead' || session.role === 'dept_manager') {
    pendingCount = await prisma.caseReview.count({ where: { reviewerId: empId, reviewStatus: '待複核' } })
    pendingLabel = '待主管複核'
  } else if (session.role === 'vp') {
    pendingCount = await prisma.caseReview.count({ where: { requiresVP: true, approvalStatus: null } })
    pendingLabel = '待執行副總閱示'
  } else if (session.role === 'admin_staff') {
    const deptFilter = session.departmentId ? { assignedDepartmentId: session.departmentId } : {}
    pendingCount = await prisma.dispatchQueue.count({ where: { status: '待取件', ...deptFilter } })
    pendingLabel = '待取件派案'
  }

  // ── Open case count (scoped) ────────────────────────────────────────────
  const openCount = await prisma.case.count({ where: { ...caseWhere, status: '未決' } })

  // ── Yearly fee (scoped) ────────────────────────────────────────────────
  const feeScope = caseScope
  const yearStart = new Date(`${currentYear}-01-01`)
  const yearEnd = new Date(`${currentYear + 1}-01-01`)

  const yearlySettlements = await prisma.settlement.findMany({
    where: {
      reportDate: { gte: yearStart, lt: yearEnd },
      case: { ...caseWhere },
    },
    select: { baseFee: true, splits: { select: { employeeId: true, amount: true, ratio: true } } },
  })

  let yearlyFee = 0
  if (session.role === 'handler') {
    yearlyFee = yearlySettlements.reduce((sum, s) => {
      const split = s.splits.find(sp => sp.employeeId === empId)
      return sum + (split?.amount ?? 0)
    }, 0)
  } else {
    yearlyFee = yearlySettlements.reduce((sum, s) => sum + s.baseFee, 0)
  }

  // ── Fee achievement rate ────────────────────────────────────────────────
  const target = await prisma.feeTarget.findFirst({
    where: { employeeId: empId, year: currentYear },
  })
  const feeAchieveRate = target?.targetAmount ? Math.min(Math.round(yearlyFee / target.targetAmount * 100), 999) : null
  const closedCount = yearlySettlements.length
  const countAchieveRate = target?.targetCaseCount ? Math.min(Math.round(closedCount / target.targetCaseCount * 100), 999) : null

  // ── Pending reviews list ──────────────────────────────────────────────
  let reviewWhere: Record<string, unknown> = {}
  if (session.role === 'handler') reviewWhere = { submittedBy: empId, reviewStatus: '退回' }
  else if (session.role === 'team_lead' || session.role === 'dept_manager') reviewWhere = { reviewerId: empId, reviewStatus: '待複核' }
  else if (session.role === 'vp') reviewWhere = { requiresVP: true, approvalStatus: null }

  const pendingReviewRows = await prisma.caseReview.findMany({
    where: reviewWhere,
    include: {
      case: {
        select: {
          caseNumber: true,
          insuredName: true,
          assignments: { where: { role: '主辦' }, include: { employee: { select: { name: true } } }, take: 1 },
        },
      },
    },
    orderBy: { submittedAt: 'desc' },
    take: 5,
  })

  const pendingReviews = pendingReviewRows.map(r => ({
    id: r.id,
    caseId: r.caseId,
    caseNumber: r.case.caseNumber,
    insuredName: r.case.insuredName,
    handlerName: r.case.assignments[0]?.employee.name ?? '—',
    documentType: r.documentType,
    reviewStatus: r.reviewStatus,
    approvalStatus: r.approvalStatus,
    submittedAt: r.submittedAt.toISOString(),
  }))

  // ── SLA warnings ──────────────────────────────────────────────────────
  const openCases = await prisma.case.findMany({
    where: { ...caseWhere, status: '未決' },
    select: {
      id: true, caseNumber: true, insuredName: true, commissionDate: true,
      preliminaryReportDate: true, currentStage: true,
      assignments: { where: { role: '主辦' }, include: { employee: { select: { name: true } } }, take: 1 },
    },
  })

  const slaWarnings = openCases
    .map(c => ({
      id: c.id,
      caseNumber: c.caseNumber,
      insuredName: c.insuredName,
      handlerName: c.assignments[0]?.employee.name ?? '—',
      commissionDate: c.commissionDate.toISOString(),
      currentStage: c.currentStage,
      slaStatus: getSlaStatus(c.commissionDate, c.preliminaryReportDate, '未決'),
    }))
    .filter(c => c.slaStatus !== 'normal')
    .sort((a, b) => (a.slaStatus === 'red' && b.slaStatus !== 'red' ? -1 : 1))
    .slice(0, 8)

  // ── Statute warnings (2-year expiry within 30 days) ───────────────────
  const expiryThreshold = today.subtract(2, 'year').add(30, 'day').toDate()

  const statuteWarnings = await prisma.case.findMany({
    where: {
      ...caseWhere,
      status: '未決',
      commissionDate: { lte: expiryThreshold },
    },
    select: {
      id: true, caseNumber: true, insuredName: true, commissionDate: true,
      assignments: { where: { role: '主辦' }, include: { employee: { select: { name: true } } }, take: 1 },
    },
    orderBy: { commissionDate: 'asc' },
  })

  const statuteRows = statuteWarnings.map(c => {
    const expiryDate = dayjs(c.commissionDate).add(2, 'year')
    const daysLeft = expiryDate.diff(today, 'day')
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      insuredName: c.insuredName,
      handlerName: c.assignments[0]?.employee.name ?? '—',
      commissionDate: c.commissionDate.toISOString(),
      expiryDate: expiryDate.format('YYYY/MM/DD'),
      daysLeft,
    }
  })

  // ── Monthly trend (current year, 6 months) ────────────────────────────
  const sixMonthsAgo = today.subtract(5, 'month').startOf('month')
  const months: { month: string; label: string }[] = []
  for (let i = 0; i < 6; i++) {
    const m = sixMonthsAgo.add(i, 'month')
    months.push({ month: m.format('YYYY-MM'), label: `${m.month() + 1}月` })
  }

  const [newCasesByMonth, closedByMonth] = await Promise.all([
    prisma.case.groupBy({
      by: ['commissionDate'],
      where: { ...caseWhere, commissionDate: { gte: sixMonthsAgo.toDate() } },
      _count: { id: true },
    }),
    prisma.case.groupBy({
      by: ['closeDate'],
      where: { ...caseWhere, status: '已決', closeDate: { gte: sixMonthsAgo.toDate(), not: null } },
      _count: { id: true },
    }),
  ])

  const monthlyData = months.map(({ month, label }) => {
    const newCount = newCasesByMonth.filter(r => dayjs(r.commissionDate).format('YYYY-MM') === month).reduce((s, r) => s + r._count.id, 0)
    const closedCount2 = closedByMonth.filter(r => r.closeDate && dayjs(r.closeDate).format('YYYY-MM') === month).reduce((s, r) => s + r._count.id, 0)
    return { month: label, 新受理: newCount, 已結案: closedCount2 }
  })

  // ── Stage distribution ────────────────────────────────────────────────
  const stageDistribution = await prisma.case.groupBy({
    by: ['currentStage'],
    where: { ...caseWhere, status: '未決' },
    _count: { id: true },
  })

  return NextResponse.json({
    success: true,
    data: {
      kpi: { pendingCount, pendingLabel, openCount, yearlyFee, feeAchieveRate, countAchieveRate, caseScope, feeScope },
      pendingReviews,
      slaWarnings,
      statuteWarnings: statuteRows,
      monthlyData,
      stageDistribution: stageDistribution.map(s => ({ stage: s.currentStage, count: s._count.id })),
    },
  })
}
