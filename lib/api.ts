'use client'

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  code?: string
  message?: string
}

async function request<T>(
  url: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
    })
    // [2026/07/01] - Lisa - 修正：優先解析後端 JSON 錯誤，非 JSON 回應才視為系統錯誤 - Start
    // 背景：原本直接 res.json()，後端若未攔截例外會回 500 非 JSON，解析爆掉 → 一律顯示「網路錯誤」，
    // 掩蓋真正的後端訊息（例如欄位驗證失敗）。改為先取文字再嘗試解析，並帶出 HTTP 狀態碼。
    const text = await res.text()
    if (text) {
      try {
        return JSON.parse(text) as ApiResponse<T>
      } catch {
        // 非 JSON（多為 500 HTML/純文字），落到下方統一處理
      }
    }
    return {
      success: false,
      error: res.ok
        ? '伺服器回應格式錯誤，請聯絡系統管理員'
        : `伺服器錯誤（${res.status}），請稍後再試；若持續發生請聯絡系統管理員`,
    }
    // [2026/07/01] - Lisa - 修正：優先解析後端 JSON 錯誤 - End
  } catch {
    return { success: false, error: '網路連線失敗，請確認網路後再試' }
  }
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body: unknown) =>
    request<T>(url, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    request<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
}
