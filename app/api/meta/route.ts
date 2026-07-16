import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const [regions, departments, insuranceCompanies, brokerCompanies, insuranceTypes, incidentLocations, incidentCauses, employees, yearRows, closeYearRows] =
    await Promise.all([
      prisma.region.findMany({ orderBy: { id: 'asc' } }),
      prisma.department.findMany({ include: { region: { select: { name: true } } }, orderBy: { id: 'asc' } }),
      prisma.insuranceCompany.findMany({ orderBy: { code: 'asc' } }),
      prisma.brokerCompany.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } }),
      prisma.insuranceType.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } }),
      prisma.incidentLocation.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      prisma.incidentCause.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } }),
      prisma.employee.findMany({
        where: { isActive: true },
        select: { id: true, name: true, username: true },
        orderBy: { name: 'asc' },
      }),
      // [2026/07/16] - Lisa - 案件查詢年度下拉改依實際資料動態產生：列出系統中所有案件的委託年度
      prisma.$queryRaw<{ year: number }[]>`
        SELECT DISTINCT EXTRACT(YEAR FROM "commissionDate")::int AS year
        FROM "cases"
        ORDER BY year DESC
      `,
      // [2026/07/16] - Lisa - 已決案明細表年度下拉：列出系統中所有已決案件的結案年度
      prisma.$queryRaw<{ year: number }[]>`
        SELECT DISTINCT EXTRACT(YEAR FROM "closeDate")::int AS year
        FROM "cases"
        WHERE "closeDate" IS NOT NULL AND "status" = '已決'
        ORDER BY year DESC
      `,
    ])

  // 合併當年度（即使尚無案件也保留當年度可選），由新到舊排序
  const currentYear = new Date().getFullYear()
  const yearSet = new Set<number>(yearRows.map((r) => Number(r.year)))
  yearSet.add(currentYear)
  const caseYears = [...yearSet].sort((a, b) => b - a)

  // 已決案結案年度（依結案日）；同樣併入當年度
  const closeYearSet = new Set<number>(closeYearRows.map((r) => Number(r.year)))
  closeYearSet.add(currentYear)
  const closeYears = [...closeYearSet].sort((a, b) => b - a)

  return NextResponse.json({
    success: true,
    data: {
      regions,
      departments: departments.map((d) => ({ ...d, regionName: d.region.name })),
      insuranceCompanies,
      brokerCompanies,
      insuranceTypes,
      incidentLocations,
      incidentCauses,
      employees,
      caseYears,
      closeYears,
    },
  })
}
