import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'

// [2026/07/01] - Lisa - 共用：安全解析請求 JSON + Zod 驗證 - Start
// 背景：多支 route 直接寫 `Schema.parse(await req.json())`，驗證失敗時 z 會 throw，
// 未被攔截 → Next.js 回 500 且 body 非 JSON → 前端 lib/api.ts 一律顯示「網路錯誤」，
// 掩蓋真正的欄位錯誤。改用此 helper：驗證失敗回傳 400 + JSON（含欄位訊息）。
export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse }

export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<ParseResult<T>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: '請求格式錯誤（非有效 JSON）', code: 'INVALID_JSON' },
        { status: 400 },
      ),
    }
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    const first = result.error.issues[0]
    const field = first?.path.join('.') || '欄位'
    const message = first ? `${field}：${first.message}` : '資料格式錯誤'
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: `資料驗證失敗 - ${message}`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      ),
    }
  }

  return { ok: true, data: result.data }
}
// [2026/07/01] - Lisa - 共用：安全解析請求 JSON + Zod 驗證 - End
