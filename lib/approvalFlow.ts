// 審核流程查表（FR-47 / FR-90）— 前後端共用純函式，移植自 demo-site approvalFlow.js

// ── 案件流程節點（FR-09：9 節點）─────────────────────────────────────
export const CASE_STAGES = [
  '進件/建檔',
  '初步報告',
  '理算表',
  '發函',
  '中間報告',
  '理算說明/協商',
  '正式結案報告',
  '請款單填寫',
  '結案',
]

// ── 文件類型（FR-12：9 種，依業務流程節點排序）───────────────────────
export const DOCUMENT_TYPES = [
  '查勘初步報告書',
  '初步預估試算表',
  '書函',
  '理算明細表',
  '進度&中間報告書',
  '中間簽結報告書',
  '理算書面報告書',
  '結案報告書',
  '公證費 DEBIT NOTE',
]

// ── 流程節點 ↔ 文件類型對照（FR-59 v2.6）────────────────────────────
export const STAGE_DOC_TYPES: Record<string, string[]> = {
  '初步報告': ['查勘初步報告書', '初步預估試算表'],
  '理算表': ['理算明細表'],
  '發函': ['書函'],
  '中間報告': ['進度&中間報告書', '中間簽結報告書'],
  '理算說明/協商': ['理算書面報告書'],
  '正式結案報告': ['結案報告書'],
  '請款單填寫': ['公證費 DEBIT NOTE'],
}

// 中間報告資訊適用文件類型（FR-85）
export const INTERIM_DOC_TYPES = ['進度&中間報告書', '中間簽結報告書']

// [2026/06/18] - Lisa - Issue #7 currentStage 只前進不回退 - Start
// 依 CASE_STAGES 順序取兩個節點中較後者；用於 currentStage 推進（送審/新增進度皆不回退）。
// 任一節點不在 CASE_STAGES 內時，回傳另一個有效節點（皆無效則回傳 a）。
export function laterStage(a: string, b: string): string {
  const ia = CASE_STAGES.indexOf(a)
  const ib = CASE_STAGES.indexOf(b)
  if (ib < 0) return a
  if (ia < 0) return b
  return ib > ia ? b : a
}
// [2026/06/18] - Lisa - Issue #7 currentStage 只前進不回退 - end

// ── 部門代號 → 審核分類 ──────────────────────────────────────────────
// 台中（CL / CB）規則暫同台北
const DEPT_CATEGORY: Record<string, string> = {
  NL: '工程_台北',
  CL: '工程_台北',
  KL: '工程_高雄',
  NB: '責任_台北',
  CB: '責任_台北',
  KB: '責任_高雄',
  NF: '火險_台北',
  KF: '火險_高雄',
}

// ── 副總審閱規則查表 ─────────────────────────────────────────────────
// alwaysVP: true  → 不論金額一律呈送副總
// threshold: N    → 預估賠償額 ≥ N 才須呈送副總
// 未列文件類型 → 套用預設門檻 100 萬
const DEFAULT_THRESHOLD = 1_000_000

// [2026/07/28] - Lisa - 副總金額門檻判定基準由「預估金額」改為「預估賠償額」- Start
/**
 * 預估賠償額 ＝ 預估金額 − 自負額（負值以 0 計），與案件金額資訊卡、Excel 匯出同一算法。
 * 副總審閱金額門檻（threshold）一律以此值比較，而非未扣自負額的預估金額。
 */
export function getClaimAmount(
  estimatedAmount: number | null | undefined,
  deductible: number | null | undefined
): number {
  return Math.max(0, (estimatedAmount ?? 0) - (deductible ?? 0))
}
// [2026/07/28] - Lisa - 副總金額門檻判定基準由「預估金額」改為「預估賠償額」- End

interface VpRule {
  alwaysVP?: boolean
  threshold?: number
}

const VP_RULES: Record<string, Record<string, VpRule>> = {
  工程_台北: {
    '查勘初步報告書': { threshold: 1_000_000 },
    '初步預估試算表': { threshold: 1_000_000 },
    '書函': { alwaysVP: true },
    '理算明細表': { threshold: 1_000_000 },
    '理算書面報告書': { threshold: 1_000_000 },
    '進度&中間報告書': { threshold: 1_000_000 },
    '中間簽結報告書': { alwaysVP: true },
    '結案報告書': { alwaysVP: true },
    '公證費 DEBIT NOTE': { alwaysVP: true },
  },
  工程_高雄: {
    '查勘初步報告書': { threshold: 1_000_000 },
    '初步預估試算表': { threshold: 1_000_000 },
    '書函': { alwaysVP: true },
    '理算明細表': { threshold: 1_000_000 },
    '理算書面報告書': { threshold: 1_000_000 },
    '進度&中間報告書': { threshold: 1_000_000 },
    '中間簽結報告書': { alwaysVP: true },
    '結案報告書': { alwaysVP: true },
    '公證費 DEBIT NOTE': { alwaysVP: true },
  },
  責任_台北: {
    '查勘初步報告書': { alwaysVP: true },
    '初步預估試算表': { alwaysVP: true },
    '書函': { alwaysVP: true },
    '理算明細表': { alwaysVP: true },
    '理算書面報告書': { alwaysVP: true },
    '進度&中間報告書': { alwaysVP: true },
    '中間簽結報告書': { alwaysVP: true },
    '結案報告書': { alwaysVP: true },
    '公證費 DEBIT NOTE': { alwaysVP: true },
  },
  責任_高雄: {
    '查勘初步報告書': { threshold: 1_000_000 },
    '初步預估試算表': { threshold: 1_000_000 },
    '書函': { alwaysVP: true },
    '理算明細表': { threshold: 1_000_000 },
    '理算書面報告書': { threshold: 1_000_000 },
    '進度&中間報告書': { threshold: 1_000_000 },
    '中間簽結報告書': { alwaysVP: true },
    '結案報告書': { alwaysVP: true },
    '公證費 DEBIT NOTE': { alwaysVP: true },
  },
  // [2026/07/09] - Lisa - 火險台北：100 萬門檻統一調整為 1,000 萬 - Start
  火險_台北: {
    '查勘初步報告書': { threshold: 10_000_000 },
    '初步預估試算表': { threshold: 10_000_000 },
    '書函': { alwaysVP: true },
    '理算明細表': { threshold: 10_000_000 },
    '理算書面報告書': { threshold: 10_000_000 },
    '進度&中間報告書': { threshold: 10_000_000 },
    '中間簽結報告書': { threshold: 10_000_000 }, // 火險：金額門檻（非 alwaysVP）
    '結案報告書': { threshold: 10_000_000 }, // 火險台北：1,000 萬門檻
    '公證費 DEBIT NOTE': { alwaysVP: true },
  },
  // [2026/07/09] - Lisa - 火險台北：100 萬門檻統一調整為 1,000 萬 - End
  火險_高雄: {
    '查勘初步報告書': { threshold: 1_000_000 },
    '初步預估試算表': { threshold: 1_000_000 },
    '書函': { alwaysVP: true },
    '理算明細表': { threshold: 1_000_000 },
    '理算書面報告書': { threshold: 1_000_000 },
    '進度&中間報告書': { threshold: 1_000_000 },
    '中間簽結報告書': { threshold: 1_000_000 }, // 火險：金額門檻（非 alwaysVP）
    '結案報告書': { threshold: 1_000_000 }, // 火險高雄：100 萬門檻
    '公證費 DEBIT NOTE': { alwaysVP: true },
  },
}

// ── 注意事項（動態產生副總門檻說明）──────────────────────────────────
function vpLine(alwaysVP: boolean, threshold: number) {
  if (alwaysVP) return '不論金額均須呈送執行副總審閱'
  const wan = Math.round(threshold / 10000)
  // [2026/07/28] - Lisa - 門檻基準改為預估賠償額（預估金額 − 自負額）
  return `預估賠償額（預估金額−自負額）≥ ${wan} 萬須轉呈執行副總審閱`
}

type NotesFn = (isLiability: boolean, alwaysVP: boolean, threshold: number) => string[]

const NOTES: Record<string, NotesFn> = {
  '查勘初步報告書': (isLiability, alwaysVP, threshold) => [
    '送批時須同步更新案件進度表，批回若有修改需再次更新',
    vpLine(alwaysVP, threshold),
    ...(isLiability
      ? ['責任險案件需同時附上「初步預估試算表」']
      : ['工程險關注案件或存在重大爭議，不分金額皆須轉執行副總審閱']),
  ],
  '初步預估試算表': (isLiability, alwaysVP, threshold) => [
    ...(isLiability
      ? ['責任險案件（體傷&死亡）必須提供，與查勘初步報告書同步送審']
      : ['工程險特殊案件提供，與查勘初步報告書同步送審']),
    vpLine(alwaysVP, threshold),
  ],
  '書函': () => [
    '所有書函（催索函 / 說明函 / 理賠函）不論金額均須呈送執行副總',
    '發函方「本公司」須改為「本公證」',
    '發函聯絡欄位需補上電子郵件',
    '文件請確認已更新為南山公證新版 Logo',
  ],
  '理算明細表': (_isLiability, alwaysVP, threshold) => [
    '須與「理算書面報告書」一併送審',
    '送審文件需包含附件頁面',
    vpLine(alwaysVP, threshold),
    '文件請確認已更新為南山公證新版 Logo',
  ],
  '進度&中間報告書': (_isLiability, alwaysVP, threshold) => [
    '功能為修正初步預估或說明新事證及保單責任分析',
    '送審時需同步提供「理算明細表」',
    '送審文件需包含附件頁面',
    vpLine(alwaysVP, threshold),
    '文件請確認已更新為南山公證新版 Logo',
  ],
  '中間簽結報告書': (_isLiability, alwaysVP, threshold) => [
    '功能為保險標的部分簽結報告，' + vpLine(alwaysVP, threshold),
    '送審時需同步提供「理算明細表」',
    '送審文件需包含附件頁面',
    '文件請確認已更新為南山公證新版 Logo',
  ],
  '理算書面報告書': (_isLiability, alwaysVP, threshold) => [
    '須與「理算明細表」一併送審',
    '送審文件需包含附件頁面',
    vpLine(alwaysVP, threshold),
    '文件請確認已更新為南山公證新版 Logo',
  ],
  '結案報告書': (_isLiability, alwaysVP, threshold) => [
    vpLine(alwaysVP, threshold),
    '公證費 DEBIT NOTE 需與結案報告書一併提送',
    '末頁一般保險公證人下方需補上「查勘人」欄位',
    '南山公證有限公司 / 一般保險公證人證書編號需確認正確',
    '理算明細表若有異動需同步提送',
  ],
  '公證費 DEBIT NOTE': () => [
    '不論金額均須呈送執行副總審閱',
    '需與「結案報告書」一併提送審查',
    '需彙整本案實際差旅，檢核申報合理性，避免漏報或超報',
    '差旅明細表及支出憑證需交行政人員備查',
  ],
}

export interface ApprovalStep {
  key: string
  title: string
  desc: string
}

export interface ApprovalFlow {
  steps: ApprovalStep[]
  notes: string[]
  alwaysVP: boolean
  amountVP: boolean
  threshold: number
  needsMidApproval: boolean
}

/**
 * 依部門、文件類型、預估賠償額回傳審核流程與注意事項（FR-47 / FR-90）
 * @param deptCode      部門代碼（NL / CL / KL / NB / CB / KB / NF / KF）
 * @param documentType  文件類型（DOCUMENT_TYPES 之一）
 * @param claimAmount   預估賠償額（＝預估金額 − 自負額，請用 getClaimAmount 計算）
 *                      [2026/07/28] - Lisa - 原為預估金額，改為已扣自負額的預估賠償額
 * @param isSpecialCase 特殊案件旗標，true 時不論金額均必送執行副總
 */
export function getApprovalFlow(
  deptCode: string | null | undefined,
  documentType: string,
  claimAmount: number | null | undefined,
  isSpecialCase = false
): ApprovalFlow {
  const category = DEPT_CATEGORY[deptCode ?? ''] ?? '工程_台北'
  const isLiability = category.startsWith('責任')

  // 工程_台北 + 特殊個案 → 三關卡（主管→高雄工程部主管→執行副總）
  const needsMidApproval = isSpecialCase && category === '工程_台北'

  const rule = VP_RULES[category]?.[documentType] ?? { threshold: DEFAULT_THRESHOLD }
  const baseAlwaysVP = rule.alwaysVP ?? false
  const baseThreshold = rule.threshold ?? DEFAULT_THRESHOLD

  const alwaysVP = baseAlwaysVP || isSpecialCase
  const amountVP = !alwaysVP && (claimAmount ?? 0) >= baseThreshold

  const steps: ApprovalStep[] = [
    { key: 'draft', title: '承辦人撰稿', desc: '完成文件後送組長互核' },
    { key: 'peer', title: '組長互核', desc: '分組互檢核查校對' },
    {
      key: 'manager',
      title: '部門主管審核',
      desc: needsMidApproval
        ? '審核後提送加簽審核'
        : alwaysVP || amountVP ? '審核後呈送執行副總' : '批稿決行',
    },
    ...(needsMidApproval
      ? [{ key: 'mid_vp', title: '加簽審核', desc: '高雄工程部主管代為審核' }]
      : []),
    ...(alwaysVP || amountVP
      ? [{
          key: 'vp',
          title: '執行副總審閱',
          desc: isSpecialCase && !baseAlwaysVP
            ? '特殊案件：不論金額一律必送'
            : alwaysVP
              ? '此類文件一律必送'
              : `估計金額 ≥ $${Math.round(baseThreshold / 10000)}萬`,
        }]
      : []),
  ]

  const notesFn = NOTES[documentType]
  const notes = notesFn ? notesFn(isLiability, alwaysVP, baseThreshold) : []

  return { steps, notes, alwaysVP, amountVP, threshold: baseThreshold, needsMidApproval }
}
