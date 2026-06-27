// ── 每日彙整排程入口（Vercel Cron）──────────────────────────────────────
// 觸發時間：每日 23:00 UTC（= 台北 07:00），於 vercel.json crons 設定。
// 工作：
//   (1) 每日彙整——台北週一～週五執行：新黃燈 / 未決案件（→ 主承辦人＋組長彙整）、待審文件（→ 審核人員）
//   (2) 每週部門彙整——僅台北「星期一」執行：部門黃 / 紅燈清單（→ 部門主管，副本執行副總）
//   * 台北星期六、日一律不發信（直接略過，不查詢、不寄送）。
//
// 授權：Vercel 在設定 CRON_SECRET 後，會自動帶 `Authorization: Bearer <CRON_SECRET>`。
//      未設定 CRON_SECRET 時不驗證（dev / 內網手動觸發友善）。

import { NextRequest, NextResponse } from 'next/server'
import { runDailyDigest, runWeeklyDeptReport } from '@/lib/digestMail'
import { taipeiNow } from '@/lib/sla'

export const dynamic = 'force-dynamic'
export const maxDuration = 60   // 彙整查詢 + 逐封寄信需較長執行時間

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ success: false, error: '未授權' }, { status: 401 })
  }

  const now = taipeiNow()                 // 台北壁鐘時間
  const dow = now.day()                   // dayjs：0=日、1=一 … 6=六
  const isMonday = dow === 1
  const isWeekend = dow === 0 || dow === 6 // 台北星期六、日不發信

  // 遇台北週六、週日，取消當日所有彙整發信
  if (isWeekend) {
    return NextResponse.json({
      success: true,
      data: { date: now.format('YYYY-MM-DD'), skipped: 'weekend', daily: null, weekly: null },
    })
  }

  try {
    const daily = await runDailyDigest(now)
    const weekly = isMonday ? await runWeeklyDeptReport(now) : null
    return NextResponse.json({
      success: true,
      data: { date: now.format('YYYY-MM-DD'), isMonday, daily, weekly },
    })
  } catch (e) {
    console.error('[cron/daily-digest] 執行例外', e)
    return NextResponse.json({ success: false, error: String(e) }, { status: 500 })
  }
}
