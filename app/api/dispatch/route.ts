import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { canDispatch } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { parseBody } from '@/lib/apiError'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const mode = searchParams.get('mode')          // 'pool' = 合併模式（待建案+待指派）
  const status = searchParams.get('status')
  const deptId = session.departmentId
  // FR-05（v3.2）：行政人員比照執行副總/系統管理員不限部門（與 lib/caseScope 對 admin_staff 全公司的處理一致），
  // 否則行政指派案件至他部門後，pool 因 deptFilter 過濾而看不到該筆
  const canSeeAll = session.role === 'vp' || session.role === 'sysadmin' || session.role === 'admin_staff'
  const deptFilter = !canSeeAll && deptId ? deptId : undefined

  // ── Pool 模式：合併 待取件佇列 + 未決且無承辦人的案件 ──────────────────
  if (mode === 'pool') {
    const [queueItems, unassignedCases] = await Promise.all([
      prisma.dispatchQueue.findMany({
        where: {
          status: '待取件',
          ...(deptFilter ? { assignedDepartmentId: deptFilter } : {}),
        },
        include: {
          insuranceCompany: { select: { name: true } },
          brokerCompany: { select: { name: true } },
          assignedDepartment: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.case.findMany({
        where: {
          status: '未決',
          assignments: { none: {} },
          ...(deptFilter ? { departmentId: deptFilter } : {}),
        },
        include: {
          insuranceCompany: { select: { name: true } },
          department: { select: { name: true } },
        },
        orderBy: { commissionDate: 'desc' },
      }),
    ])

    const poolData = [
      ...queueItems.map((d) => ({
        _type: 'queue' as const,
        id: d.id,
        desc: d.sourceReference,
        draftData: d.draftData,
        insuranceCompanyId: d.insuranceCompanyId,
        insuranceCompanyName: d.insuranceCompany.name,
        brokerCompanyId: d.brokerCompanyId,
        brokerCompanyName: d.brokerCompany?.name ?? null,
        assignedDepartmentId: d.assignedDepartmentId,
        departmentName: d.assignedDepartment.name,
        incidentLocation: null as string | null,
        insuranceType: null as string | null,
        info: d.assignmentNotes ?? null,
        time: d.createdAt.toISOString(),
      })),
      ...unassignedCases.map((c) => ({
        _type: 'case' as const,
        id: c.id,
        desc: `${c.caseNumber}　${c.insuredName}`,
        draftData: null,
        insuranceCompanyId: c.insuranceCompanyId,
        insuranceCompanyName: c.insuranceCompany.name,
        brokerCompanyId: c.brokerCompanyId,
        brokerCompanyName: null as string | null,
        assignedDepartmentId: c.departmentId,
        departmentName: c.department.name,
        incidentLocation: c.incidentLocation,
        insuranceType: c.insuranceType,
        info: c.incidentCause,
        time: c.commissionDate.toISOString(),
      })),
    ]

    return NextResponse.json({ success: true, data: poolData })
  }

  // ── 一般模式（依 status 篩選）──────────────────────────────────────────
  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (deptFilter) where.assignedDepartmentId = deptFilter

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

  // [2026/07/01] - Lisa - 改用 parseBody：驗證失敗回 400 JSON，不再 throw 成 500 非 JSON
  const parsed = await parseBody(req, CreateSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data
  const item = await prisma.dispatchQueue.create({
    data: { ...body, assignedBy: parseInt(session.sub) },
  })
  return NextResponse.json({ success: true, data: { id: item.id } }, { status: 201 })
}
