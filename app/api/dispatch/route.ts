import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { canDispatch } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const status = searchParams.get('status')
  const deptId = session.departmentId

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (deptId && session.role !== 'vp' && session.role !== 'sysadmin') {
    where.assignedDepartmentId = deptId
  }

  const items = await prisma.dispatchQueue.findMany({
    where,
    include: {
      insuranceCompany: { select: { name: true } },
      brokerCompany: { select: { name: true } },
      assignedDepartment: { select: { name: true } },
      assigner: { select: { name: true } },
      picker: { select: { name: true } },
      case: { select: { caseNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({
    success: true,
    data: items.map((d) => ({
      id: d.id,
      sourceType: d.sourceType,
      sourceReference: d.sourceReference,
      insuranceCompanyId: d.insuranceCompanyId,
      insuranceCompanyName: d.insuranceCompany.name,
      brokerCompanyId: d.brokerCompanyId,
      brokerCompanyName: d.brokerCompany?.name ?? null,
      assignedDepartmentId: d.assignedDepartmentId,
      assignedDepartmentName: d.assignedDepartment.name,
      assignmentNotes: d.assignmentNotes,
      status: d.status,
      assignedBy: d.assignedBy,
      assignerName: d.assigner.name,
      pickedBy: d.pickedBy,
      pickerName: d.picker?.name ?? null,
      createdAt: d.createdAt.toISOString(),
      draftData: d.draftData,
      caseNumber: d.case?.caseNumber ?? null,
    })),
  })
}

const CreateSchema = z.object({
  sourceType: z.string(),
  sourceReference: z.string(),
  insuranceCompanyId: z.number(),
  brokerCompanyId: z.number().nullable().optional(),
  assignedDepartmentId: z.number(),
  assignmentNotes: z.string().optional(),
  draftData: z.string().nullable().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (!canDispatch(session.role)) return NextResponse.json({ success: false, error: '無權限' }, { status: 403 })

  const body = CreateSchema.parse(await req.json())
  const item = await prisma.dispatchQueue.create({
    data: { ...body, assignedBy: parseInt(session.sub) },
  })
  return NextResponse.json({ success: true, data: { id: item.id } }, { status: 201 })
}
