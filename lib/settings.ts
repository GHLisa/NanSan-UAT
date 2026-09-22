// ── 系統參數設定（key-value）存取層 ─────────────────────────────────────
// 僅系統管理員可於「系統管理 → 系統參數設定」維護。
// email.ts 依 email_enabled 判斷寄信總開關；讀取失敗一律 fail-open（預設啟動），
// 確保正式站「先部署程式、後 db push 建表」的時序下不會誤擋寄信。

import { prisma } from './prisma'

export const EMAIL_ENABLED_KEY = 'email_enabled'

// [2026/09/22] - Lisa - FR-120：高雄火險部特殊案件指定可視人員（案件管理）。
// 值為員工 id 逗號分隔字串（如 "3,17,22"），空字串＝未指定任何人。
export const KHH_FIRE_SPECIAL_CASE_VIEWERS_KEY = 'khh_fire_special_case_viewer_ids'

// 已知系統參數的預設定義；GET 時據此補齊缺漏列，確保各環境都有預設值
export const DEFAULT_SETTINGS: { key: string; value: string; label: string; description: string }[] = [
  {
    key: EMAIL_ENABLED_KEY,
    value: 'Y',
    label: '是否啟動寄信功能',
    description: 'Y＝啟動寄信；非 Y（如 N）＝全系統停止寄信（含即時通知與每日彙整），僅記錄為略過。',
  },
  {
    key: KHH_FIRE_SPECIAL_CASE_VIEWERS_KEY,
    value: '',
    label: '高雄火險部特殊案件可視人員',
    description: '高雄火險部案件勾選「特殊案件」後，除原本可視範圍（承辦人/本部門人員）外，此處指定的人員亦可在「案件管理」查看該案件（唯讀，不影響編輯/送審等操作權限）。',
  },
]

// 讀取單一參數值；不存在時回該參數預設值（非已知參數回 null）
export async function getSettingValue(key: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key } })
  if (row) return row.value
  return DEFAULT_SETTINGS.find(d => d.key === key)?.value ?? null
}

// 寄信總開關：僅當值為 'Y'（去空白、不分大小寫）才啟動；預設 Y。
// 讀取失敗（如參數表尚未建立）→ 回 true（fail-open），避免誤擋寄信。
export async function isEmailEnabled(): Promise<boolean> {
  try {
    const v = await getSettingValue(EMAIL_ENABLED_KEY)
    return (v ?? 'Y').trim().toUpperCase() === 'Y'
  } catch {
    return true
  }
}

// FR-120：高雄火險部特殊案件可視人員清單（員工 id）。讀取失敗一律回空陣列（fail-closed，不擴大可視範圍）。
export async function getKhhFireSpecialCaseViewerIds(): Promise<number[]> {
  try {
    const v = await getSettingValue(KHH_FIRE_SPECIAL_CASE_VIEWERS_KEY)
    if (!v) return []
    return v.split(',').map(s => parseInt(s.trim())).filter(n => !Number.isNaN(n))
  } catch {
    return []
  }
}
