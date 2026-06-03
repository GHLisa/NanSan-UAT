import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const NoteSchema = z.object({
  content: z.string().min(1),
  noteDate: z.string(),
})

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const caseId = parseInt(params.id)
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
