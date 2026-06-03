import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const ProgressSchema = z.object({
  stage: z.string(),
  progressDate: z.string(),
  description: z.string().optional(),
})

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const caseId = parseInt(params.id)
  const body = ProgressSchema.parse(await req.json())

  const progress = await prisma.caseProgress.create({
    data: {
      caseId,
      stage: body.stage,
      progressDate: new Date(body.progressDate),
      description: body.description,
      createdBy: parseInt(session.sub),
    },
  })

  // Update currentStage on case
  await prisma.case.update({
    where: { id: caseId },
    data: { currentStage: body.stage },
  })

  return NextResponse.json({ success: true, data: { id: progress.id } }, { status: 201 })
}
