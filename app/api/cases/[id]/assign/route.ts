import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { mailNewAssignment, mailAssignmentChanged } from '@/lib/caseMail'
import { newAssignmentNotification, assignmentChangedNotification } from '@/lib/caseNotify'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const caseId = parseInt(params.id)
  const { assignees, overwrite } = await req.json() as {
    assignees: { employeeId: number; role: string; contributionRatio: number }[]
    overwrite?: boolean
  }

  if (!assignees?.length) {
    return NextResponse.json({ success: false, error: '至少需要一位承辦人' }, { status: 400 })
  }

  const totalRatio = assignees.reduce((s, a) => s + a.contributionRatio, 0)
  if (Math.abs(totalRatio - 1.0) > 0.01) {
    return NextResponse.json({ success: false, error: '承辦比例合計必須等於 100%' }, { status: 400 })
  }

  const empId = parseInt(session.sub)

  // ── overwrite=true：整批覆寫承辦人（FR-33/46/65 編輯模式）──────────
  if (overwrite) {
    const existing = await prisma.case.findUnique({
      where: { id: caseId },
      include: { assignments: { select: { employeeId: true, role: true } } },
    })
    if (!existing) return NextResponse.json({ success: false, error: '找不到案件' }, { status: 404 })
    if (existing.status !== '未決') {
      return NextResponse.json({ success: false, error: '已決／銷案案件不可編輯' }, { status: 409 })
    }
    const isAssignee = existing.assignments.some((a) => a.employeeId === empId)
    const isManager =
      (session.role === 'dept_manager' && session.departmentId === existing.departmentId) ||
      session.role === 'sysadmin'
    if (!isAssignee && !isManager) {
      return NextResponse.json({ success: false, error: '非本案承辦人，無權編輯' }, { status: 403 })
    }

    // [2026/06/24] - Lisa - 編輯模式新增/更換承辦人時亦需通知：
    // 比對 employeeId+role 簽章集合，僅在承辦人「新增/移除/主辦更換」時通知（純比例調整不通知）
    const oldSig = new Set(existing.assignments.map((a) => `${a.employeeId}:${a.role}`))
    const newSig = new Set(assignees.map((a) => `${a.employeeId}:${a.role}`))
    const assigneesChanged =
      oldSig.size !== newSig.size || [...newSig].some((s) => !oldSig.has(s))

    await prisma.$transaction([
      prisma.caseAssignment.deleteMany({ where: { caseId } }),
      prisma.caseAssignment.createMany({
        data: assignees.map((a) => ({
          caseId,
          employeeId: a.employeeId,
          role: a.role,
          contributionRatio: a.contributionRatio,
        })),
      }),
      prisma.caseLog.create({
        data: { caseId, employeeId: empId, fieldName: '承辦人', newValue: '承辦人已變更', logType: 'edit' },
      }),
      // 站內通知：承辦人異動 → 觸達該案目前全部承辦人（主辦＋協辦，含新增者）
      ...(assigneesChanged
        ? [prisma.notification.create({
            data: assignmentChangedNotification(caseId, existing.caseNumber, existing.insuredName),
          })]
        : []),
    ])

    // Email：承辦人異動 → 通知目前全部承辦人（交易後讀取＝新名單，含新增者）；寄信失敗不影響編輯
    if (assigneesChanged) await mailAssignmentChanged(caseId, existing.caseNumber, existing.insuredName)

    return NextResponse.json({ success: true })
  }

  // ── 預設：取件時建立承辦人 ───────────────────────────────────
  // 先取案件基本資料（供站內通知與寄信共用），讓派案通知能與指派同交易寫入
  const assignedCase = await prisma.case.findUnique({
    where: { id: caseId },
    select: { caseNumber: true, insuredName: true },
  })

  await prisma.$transaction([
    prisma.caseAssignment.createMany({
      data: assignees.map(a => ({
        caseId, employeeId: a.employeeId, role: a.role,
        contributionRatio: a.contributionRatio,
      })),
    }),
    prisma.caseProgress.create({
      data: {
        caseId,
        stage: '進件/建檔',
        progressDate: new Date(),
        description: `取件完成 (${session.name})`,
        createdBy: empId,
      },
    }),
    prisma.caseLog.create({
      data: {
        caseId,
        employeeId: empId,
        fieldName: '取件',
        logType: 'create',
        newValue: assignees.map(a => `${a.role}:${a.contributionRatio * 100}%`).join(', '),
      },
    }),
    // [2026/06/24] - Lisa - 派案通知：派案池取件指派 → 寫入站內通知（主辦＋協辦）
    ...(assignedCase
      ? [prisma.notification.create({
          data: newAssignmentNotification(caseId, assignedCase.caseNumber, assignedCase.insuredName),
        })]
      : []),
  ])

  // 立即通知（1）新派案 → 主承辦人＋協辦人（派案池取件指派）；寄信失敗不影響指派結果
  if (assignedCase) await mailNewAssignment(caseId, assignedCase.caseNumber, assignedCase.insuredName)

  return NextResponse.json({ success: true })
}
