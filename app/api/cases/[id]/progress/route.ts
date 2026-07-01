import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { laterStage } from '@/lib/approvalFlow'
import { z } from 'zod'
import { parseBody } from '@/lib/apiError'

const ProgressSchema = z.object({
  stage: z.string(),
  progressDate: z.string(),
  description: z.string().optional(),
})

// FR-35/58：僅未決案件且呼叫者為承辦人（或主管）可新增進度
async function assertCanAddRecord(
  session: { sub: string; role: string; departmentId: number | null },
  caseId: number,
): Promise<{ ok: true; currentStage: string } | { ok: false; status: number; error: string }> {
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    include: { assignments: { select: { employeeId: true } } },
  })
  if (!c) return { ok: false, status: 404, error: '找不到案件' }
  if (c.status !== '未決') return { ok: false, status: 409, error: '已決／銷案案件不可新增進度' }
  const empId = parseInt(session.sub)
  const isAssignee = c.assignments.some((a) => a.employeeId === empId)
  // [2026/06/18] - Lisa - 行政人員代為（非審核）：有部門限本部門、無部門全公司
  const isManager =
    (session.role === 'dept_manager' && session.departmentId === c.departmentId) ||
    session.role === 'sysadmin' ||
    (session.role === 'admin_staff' && (session.departmentId == null || session.departmentId === c.departmentId))
  if (!isAssignee && !isManager) return { ok: false, status: 403, error: '非本案承辦人，無權新增進度' }
  return { ok: true, currentStage: c.currentStage }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const caseId = parseInt(params.id)
  const perm = await assertCanAddRecord(session, caseId)
  if (!perm.ok) return NextResponse.json({ success: false, error: perm.error }, { status: perm.status })

  // [2026/07/01] - Lisa - 改用 parseBody：驗證失敗回 400 JSON，不再 throw 成 500 非 JSON
  const parsed = await parseBody(req, ProgressSchema)
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  const progress = await prisma.caseProgress.create({
    data: {
      caseId,
      stage: body.stage,
      progressDate: new Date(body.progressDate),
      description: body.description,
      createdBy: parseInt(session.sub),
    },
  })

  // [2026/06/18] - Lisa - Issue #7 currentStage 只前進不回退（取較後節點）- Start
  const advancedStage = laterStage(perm.currentStage, body.stage)
  if (advancedStage !== perm.currentStage) {
    await prisma.case.update({
      where: { id: caseId },
      data: { currentStage: advancedStage },
    })
  }
  // [2026/06/18] - Lisa - Issue #7 currentStage 只前進不回退 - end

  return NextResponse.json({ success: true, data: { id: progress.id } }, { status: 201 })
}
