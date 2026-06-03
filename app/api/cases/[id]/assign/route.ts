import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const caseId = parseInt(params.id)
  const { assignees } = await req.json() as {
    assignees: { employeeId: number; role: string; contributionRatio: number }[]
  }

  if (!assignees?.length) {
    return NextResponse.json({ success: false, error: '至少需要一位承辦人' }, { status: 400 })
  }

  const totalRatio = assignees.reduce((s, a) => s + a.contributionRatio, 0)
  if (Math.abs(totalRatio - 1.0) > 0.01) {
    return NextResponse.json({ success: false, error: '承辦人分工比例合計必須等於 100%' }, { status: 400 })
  }

  const empId = parseInt(session.sub)

  await prisma.$transaction([
    prisma.caseAssignment.createMany({
      data: assignees.map(a => ({ caseId, ...a })),
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
  ])

  return NextResponse.json({ success: true })
}
