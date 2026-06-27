import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const NoteSchema = z.object({
  content: z.string().min(1),
  noteDate: z.string(),
})

// FR-35/58：僅未決案件且呼叫者為承辦人（或主管）可新增紀錄
async function assertCanAddRecord(
  session: { sub: string; role: string; departmentId: number | null },
  caseId: number,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const c = await prisma.case.findUnique({
    where: { id: caseId },
    include: { assignments: { select: { employeeId: true } } },
  })
  if (!c) return { ok: false, status: 404, error: '找不到案件' }
  if (c.status !== '未決') return { ok: false, status: 409, error: '已決／銷案案件不可新增紀錄' }
  const empId = parseInt(session.sub)
  const isAssignee = c.assignments.some((a) => a.employeeId === empId)
  const isManager =
    (session.role === 'dept_manager' && session.departmentId === c.departmentId) ||
    session.role === 'sysadmin'
  if (!isAssignee && !isManager) return { ok: false, status: 403, error: '非本案承辦人，無權新增紀錄' }
  return { ok: true }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const caseId = parseInt(params.id)
  const perm = await assertCanAddRecord(session, caseId)
  if (!perm.ok) return NextResponse.json({ success: false, error: perm.error }, { status: perm.status })

  const body = NoteSchema.parse(await req.json())

  const note = await prisma.caseNote.create({
    data: {
      caseId,
      createdBy: parseInt(session.sub),
      noteDate: new Date(body.noteDate),
      content: body.content,
    },
  })

  return NextResponse.json({ success: true, data: { id: note.id } }, { status: 201 })
}
