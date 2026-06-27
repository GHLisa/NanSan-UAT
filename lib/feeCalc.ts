import { prisma } from '@/lib/prisma'

// ── Types ────────────────────────────────────────────────────────────────────
export interface FeeBandResult {
  range: string
  amount: number   // 本段計算量（落在此級距的金額）
  rate: number     // 本段適用費率
  fee: number      // 本段小計
}

export interface FeeCalcResult {
  fee: number
  bands: FeeBandResult[]
  minApplied: boolean
  feeCategory: string
}

interface CalcOptions {
  insuranceCompanyId: number
  insuranceTypeId: number
  commissionDate?: string | Date
}

interface RateBand {
  maxAmount: number | null
  rate: number | null
}

const MIN_FEE = 20000

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseRateBands(json: string): RateBand[] {
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed as RateBand[]
  } catch {
    return []
  }
}

function fmtAmount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toLocaleString()}億`
  if (n >= 10_000) return `${(n / 10_000).toLocaleString()}萬`
  return n.toLocaleString()
}

function fmtRange(prev: number, max: number | null): string {
  const lo = prev <= 0 ? '0' : fmtAmount(prev)
  const hi = max == null ? '以上' : fmtAmount(max)
  return max == null ? `${lo} 以上` : `${lo} ~ ${hi}`
}

/**
 * 分段累進計算。
 * - rateBands 依 maxAmount 升冪排序（null 視為最高，排最後）。
 * - 每段計算量 = min(剩餘金額, 本段上限 - 前段上限)。
 * - 最後一段（maxAmount=null）延伸至無上限。
 * - rate 為 null（另議）的段略過，由前一段延伸覆蓋。
 */
function progressiveCalc(amount: number, rawBands: RateBand[]): { fee: number; bands: FeeBandResult[] } {
  const bands = [...rawBands].sort((a, b) => {
    const am = a.maxAmount == null ? Number.MAX_SAFE_INTEGER : a.maxAmount
    const bm = b.maxAmount == null ? Number.MAX_SAFE_INTEGER : b.maxAmount
    return am - bm
  })

  const result: FeeBandResult[] = []
  let fee = 0
  let prev = 0
  let lastRate: number | null = null

  for (let i = 0; i < bands.length; i++) {
    if (prev >= amount) break
    const band = bands[i]
    const isLast = i === bands.length - 1
    const upper = band.maxAmount == null || isLast ? amount : Math.min(band.maxAmount, amount)
    const segAmount = upper - prev
    if (segAmount <= 0) {
      // 已超過此段上限但金額尚未填滿，僅推進 prev
      prev = band.maxAmount ?? prev
      if (band.rate != null) lastRate = band.rate
      continue
    }

    // rate=null（另議）→ 沿用前一段費率
    const rate: number | null = band.rate != null ? band.rate : lastRate
    if (rate != null) lastRate = rate

    const segFee = rate != null ? Math.round(segAmount * rate) : 0
    fee += segFee
    result.push({
      range: fmtRange(prev, band.maxAmount),
      amount: segAmount,
      rate: rate ?? 0,
      fee: segFee,
    })

    prev = band.maxAmount == null ? amount : band.maxAmount
  }

  return { fee, bands: result }
}

// ── Main ─────────────────────────────────────────────────────────────────────
/**
 * 公證費分段累進計算（FR-18，FSD §4.2.4）。
 *
 * 邏輯：
 *  1. 由 insuranceTypeId 查 insuranceType.feeCategory：
 *     工程險 / 責任險 → companyFeeRate
 *     火險            → companyFireRate
 *     水險 / 查無資料 → 回傳最低費 NT$20,000（minApplied=true）
 *  2. 由 insuranceCompanyId 取得公司 code，配合 effectiveDate ≤ commissionDate 取最新一筆費率。
 *  3. rateBands 升冪排序，分段累進加總。
 *  4. 合計 < minFee → 套用最低公證費（minApplied=true）。
 *  5. 查無費率 → fallback 最低費並註記。
 */
export async function calcCertificationFee(
  amount: number,
  { insuranceCompanyId, insuranceTypeId, commissionDate }: CalcOptions,
): Promise<FeeCalcResult> {
  const commDate = commissionDate ? new Date(commissionDate) : new Date()

  // 1. 查費率類別
  const insType = await prisma.insuranceType.findUnique({ where: { id: insuranceTypeId } })
  const feeCategory = insType?.feeCategory ?? ''

  // 水險 / 查無險種 → 最低費
  if (!insType || feeCategory === '水險') {
    return { fee: MIN_FEE, bands: [], minApplied: true, feeCategory: feeCategory || '水險' }
  }

  // 2. 取得公司代號
  const company = await prisma.insuranceCompany.findUnique({ where: { id: insuranceCompanyId } })
  if (!company) {
    return { fee: MIN_FEE, bands: [], minApplied: true, feeCategory }
  }

  // 3. 依類別取費率（effectiveDate ≤ commissionDate 取最新）
  let rawBands: RateBand[] | null = null
  let minFee = MIN_FEE

  if (feeCategory === '火險') {
    const rate = await prisma.companyFireRate.findFirst({
      where: { companyCode: company.code, effectiveDate: { lte: commDate } },
      orderBy: { effectiveDate: 'desc' },
    })
    if (rate) {
      rawBands = parseRateBands(rate.rateBands)
      minFee = rate.minFee
    }
  } else if (feeCategory === '工程險' || feeCategory === '責任險') {
    const rate = await prisma.companyFeeRate.findFirst({
      where: { companyCode: company.code, effectiveDate: { lte: commDate } },
      orderBy: { effectiveDate: 'desc' },
    })
    if (rate) {
      rawBands = parseRateBands(rate.rateBands)
      minFee = rate.minFee
    }
  }

  // 查無費率 → fallback 最低費
  if (!rawBands || rawBands.length === 0) {
    return { fee: MIN_FEE, bands: [], minApplied: true, feeCategory }
  }

  // 4. 分段累進
  const { fee: rawFee, bands } = progressiveCalc(Math.max(amount, 0), rawBands)

  // 5. 低於最低費 → 套用最低費
  if (rawFee < minFee) {
    return { fee: minFee, bands, minApplied: true, feeCategory }
  }

  return { fee: rawFee, bands, minApplied: false, feeCategory }
}
