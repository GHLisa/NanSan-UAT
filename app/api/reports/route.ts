import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()))
  const deptId = searchParams.get('deptId') ? parseInt(searchParams.get('deptId')!) : null

  const yearStart = new Date(`${year}-01-01`)
  const yearEnd = new Date(`${year + 1}-01-01`)

  // Scope by dept
  const caseFilter: Record<string, unknown> = {
    closeDate: { gte: yearStart, lt: yearEnd },
    status: '已決',
  }

  if (!canViewAllDepts(session.role) && session.departmentId) {
    caseFilter.departmentId = session.departmentId
  } else if (deptId) {
    caseFilter.departmentId = deptId
  }

  // Employee performance: settled cases per employee
  const settlements = await prisma.settlement.findMany({
    where: { case: caseFilter },
    include: {
      splits: { include: { employee: { select: { id: true, name: true } } } },
      case: { select: { departmentId: true, insuranceType: true } },
    },
  })

  const empMap: Record<number, { id: number; name: string; caseCount: number; totalFee: number }> = {}

  for (const s of settlements) {
    for (const sp of s.splits) {
      if (!empMap[sp.employeeId]) {
        empMap[sp.employeeId] = { id: sp.employeeId, name: sp.employee.name, caseCount: 0, totalFee: 0 }
      }
      empMap[sp.employeeId].caseCount += 1
      empMap[sp.employeeId].totalFee += sp.amount
    }
  }

  // Monthly case count
  const allClosedCases = await prisma.case.findMany({
    where: caseFilter,
    select: { closeDate: true, actualFee: true },
  })

  const monthlyCounts: { month: string; count: number; fee: number }[] = []
  for (let m = 1; m <= 12; m++) {
    const label = `${year}-${String(m).padStart(2, '0')}`
    const monthStart = new Date(`${year}-${String(m).padStart(2, '0')}-01`)
    const monthEnd = new Date(m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`)
    const monthCases = allClosedCases.filter((c) => {
      const d = c.closeDate ? new Date(c.closeDate) : null
      return d && d >= monthStart && d < monthEnd
    })
    monthlyCounts.push({ month: label, count: monthCases.length, fee: monthCases.reduce((s, c) => s + (c.actualFee ?? 0), 0) })
  }

  return NextResponse.json({
    success: true,
    data: {
      year,
      employeePerformance: Object.values(empMap).sort((a, b) => b.totalFee - a.totalFee),
      monthlyStats: monthlyCounts,
    },
  })
}
