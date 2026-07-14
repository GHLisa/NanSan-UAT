// ── 即時事件批次彙整排程入口・下午場（Vercel Cron）──────────────────────
// 觸發時間：台北平日 16:00（= UTC 08:00），於 vercel.json crons 設定。
// [2026/07/15] - Lisa - Hobby 方案僅允許 2 個 cron：上午場（08:00）併入 /api/cron/daily-digest，
// 本排程負責下午場。工作：把 mail_event_queue 待寄事件依收件人彙整成單封信寄出（原「即時信」改批次）。
// 台北星期六、日一律不寄（事件留在佇列，待下一個平日時段一併送出）。
//
// 授權：Vercel 設定 CRON_SECRET 後會自動帶 Authorization: Bearer <CRON_SECRET>；未設定則不驗證。

import { NextRequest, NextResponse } from 'next/server'
import { runEventDigest } from '@/lib/digestMail'
import { taipeiNow } from '@/lib/sla'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: '未授權' }, { status: 401 })
  }

  const now = taipeiNow()
  const dow = now.day()                    // 0=日、6=六
  if (dow === 0 || dow === 6) {
    return NextResponse.json({
      success: true,
      data: { date: now.format('YYYY-MM-DD'), skipped: 'weekend' },
    })
  }

  try {
    const result = await runEventDigest()
    return NextResponse.json({
      success: true,
      data: { at: now.format('YYYY-MM-DD HH:mm'), ...result },
    })
  } catch (e) {
    console.error('[cron/event-digest] 執行例外', e)
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
