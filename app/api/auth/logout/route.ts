import { NextResponse } from 'next/server'
import { clearCookieHeader } from '@/lib/auth'

export async function POST() {
  const res = NextResponse.json({ success: true })
  res.headers.set('Set-Cookie', clearCookieHeader())
  return res
}
