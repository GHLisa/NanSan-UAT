import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const [regions, departments, insuranceCompanies, brokerCompanies, insuranceTypes, incidentLocations, employees] =
    await Promise.all([
      prisma.region.findMany({ orderBy: { id: 'asc' } }),
      prisma.department.findMany({ include: { region: { select: { name: true } } }, orderBy: { id: 'asc' } }),
      prisma.insuranceCompany.findMany({ orderBy: { code: 'asc' } }),
      prisma.brokerCompany.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } }),
      prisma.insuranceType.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } }),
      prisma.incidentLocation.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      prisma.employee.findMany({
        where: { isActive: true },
        select: { id: true, name: true, username: true },
        orderBy: { name: 'asc' },
      }),
    ])

  return NextResponse.json({
    success: true,
    data: {
      regions,
      departments: departments.map((d) => ({ ...d, regionName: d.region.name })),
      insuranceCompanies,
      brokerCompanies,
      insuranceTypes,
      incidentLocations,
      employees,
    },
  })
}
