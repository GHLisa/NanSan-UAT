import { NextRequest, NextResponse } from 'next/server'
import { getSession, JWTPayload } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { splitFeeByRatio } from '@/lib/feeSplit'
import { getPrepaidTotals, getPrepayEventsInRange } from '@/lib/feeRecognition'
import ExcelJS from 'exceljs'
import dayjs from 'dayjs'
import { taipeiNow } from '@/lib/sla'

export const runtime = 'nodejs'

// [2026/08/19] - Lisa - 歷史年度目標查詢匯出 Excel。可見範圍／季目標換算邏輯需與 GET /api/performance?mode=history
// 保持一致（本檔為獨立路由，比照本專案其他報表 export/route.ts 與查詢路由分檔的慣例，故重複這段邏輯）
const TARGET_ROLES = ['handler', 'team_lead', 'dept_manager']
const COMPANY_WIDE_ROLES = ['vp', 'admin_staff', 'sysadmin']
const QUARTER_END_MONTH: Record<string, number> = { 'Q1': 3, 'Q1~Q2': 6, 'Q1~Q3': 9, 'Q1~Q4': 12 }
const QUARTER_COUNT: Record<string, number> = { 'Q1': 1, 'Q1~Q2': 2, 'Q1~Q3': 3, 'Q1~Q4': 4 }

const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9E1F2' } }
const TOTAL_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF7E6' } }
const THIN_BORDER = {
  top: { style: 'thin' as const }, left: { style: 'thin' as const },
  bottom: { style: 'thin' as const }, right: { style: 'thin' as const },
}

async function getSubordinates(session: JWTPayload) {
  let roleWhere: Record<string, unknown> | null = null
  if (session.role === 'handler') {
    roleWhere = { employeeId: parseInt(session.sub) }
  } else if (session.role === 'team_lead' && session.departmentId) {
    roleWhere = { departmentId: session.departmentId, teamGroup: session.teamGroup, role: { in: ['handler', 'team_lead'] } }
  } else if (session.role === 'dept_manager' && session.departmentId) {
    roleWhere = { departmentId: session.departmentId, role: { in: TARGET_ROLES } }
  } else if (COMPANY_WIDE_ROLES.includes(session.role)) {
    roleWhere = { role: { in: TARGET_ROLES } }
  }
  if (!roleWhere) return []

  const roles = await prisma.employeeRole.findMany({
    where: { ...roleWhere, employee: { isActive: true } },
    select: {
      employeeId: true,
      teamGroup: true,
      isPrimary: true,
      employee: { select: { name: true } },
      department: { select: { name: true, code: true } },
    },
  })

  const byEmployee = new Map<
    number,
    { id: number; name: string; departmentName: string; departmentCode: string; teamGroup: string | null; isPrimary: boolean }
  >()
  for (const r of roles) {
    const prev = byEmployee.get(r.employeeId)
    if (prev && !(r.isPrimary && !prev.isPrimary)) continue
    byEmployee.set(r.employeeId, {
      id: r.employeeId,
      name: r.employee.name,
      departmentName: r.department?.name ?? '',
      departmentCode: r.department?.code ?? '',
      teamGroup: r.teamGroup,
      isPrimary: r.isPrimary,
    })
  }

  return [...byEmployee.values()].sort(
    (a, b) =>
      a.departmentCode.localeCompare(b.departmentCode) ||
      (a.teamGroup ?? '').localeCompare(b.teamGroup ?? '') ||
      a.id - b.id
  )
}

// [2026/08/19] - Lisa - quarterEndMonth：限縮 closeDate 月份（1~該月），供季目標統計換算；預設 12（全年）
async function calcActuals(empIds: number[], years: number[], quarterEndMonth = 12) {
  const map = new Map<string, { fee: number; count: number }>()
  if (empIds.length === 0 || years.length === 0) return map

  const minYear = Math.min(...years)
  const maxYear = Math.max(...years)
  const rangeStart = new Date(`${minYear}-01-01`)
  const rangeEnd = new Date(`${maxYear + 1}-01-01`)
  const closedCases = await prisma.case.findMany({
    where: { closeDate: { gte: rangeStart, lt: rangeEnd } },
    select: {
      id: true,
      closeDate: true,
      actualFee: true,
      assignments: { select: { employeeId: true, role: true, contributionRatio: true } },
    },
  })

  // [2026/08/21] - Lisa - 公證費預付請款依出具日期認列：結案月改用 actualFee 扣除該案累計已認列的
  // 預付金額（避免與出具當月重複計入，可能為負），並把預付事件依出具日期併入同一 year/quarterEndMonth 口徑。
  const prepaidTotals = await getPrepaidTotals(closedCases.map((c) => c.id))

  const yearSet = new Set(years)
  const empSet = new Set(empIds)
  for (const c of closedCases) {
    const year = dayjs(c.closeDate).year()
    if (!yearSet.has(year)) continue
    if (dayjs(c.closeDate).month() + 1 > quarterEndMonth) continue
    const netFee = (c.actualFee ?? 0) - (prepaidTotals.get(c.id) ?? 0)
    const amts = splitFeeByRatio(netFee, c.assignments, a => a.contributionRatio ?? 1, a => a.role === '主辦')
    c.assignments.forEach((a, i) => {
      if (!empSet.has(a.employeeId)) return
      const key = `${a.employeeId}-${year}`
      const entry = map.get(key) ?? { fee: 0, count: 0 }
      if (a.role === '主辦') entry.count += 1
      entry.fee += amts[i]
      map.set(key, entry)
    })
  }

  const prepayEvents = await getPrepayEventsInRange({}, { gte: rangeStart, lte: new Date(rangeEnd.getTime() - 1) })
  for (const e of prepayEvents) {
    const year = dayjs(e.issuedAt).year()
    if (!yearSet.has(year)) continue
    if (dayjs(e.issuedAt).month() + 1 > quarterEndMonth) continue
    const amts = splitFeeByRatio(e.amount, e.assignments, a => a.contributionRatio ?? 1, a => a.role === '主辦')
    e.assignments.forEach((a, i) => {
      if (!empSet.has(a.employeeId)) return
      const key = `${a.employeeId}-${year}`
      const entry = map.get(key) ?? { fee: 0, count: 0 }
      // 預付請款尚未結案，不計入件數，只計金額份額
      entry.fee += amts[i]
      map.set(key, entry)
    })
  }
  return map
}

function styleHeaderRow(row: ExcelJS.Row, colCount: number) {
  row.height = 24
  row.font = { bold: true, size: 11 }
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  for (let col = 1; col <= colCount; col++) {
    row.getCell(col).fill = HEADER_FILL
    row.getCell(col).border = THIN_BORDER
  }
}

function styleBody(row: ExcelJS.Row, colCount: number, moneyCols: number[]) {
  row.alignment = { vertical: 'middle', horizontal: 'center' }
  for (const col of moneyCols) {
    row.getCell(col).numFmt = '#,##0'
    row.getCell(col).alignment = { vertical: 'middle', horizontal: 'right' }
  }
  for (let col = 1; col <= colCount; col++) row.getCell(col).border = THIN_BORDER
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const subordinates = await getSubordinates(session)
  const subIds = subordinates.map((s) => s.id)

  const { searchParams } = req.nextUrl
  const quarterParam = searchParams.get('quarter') ?? 'Q1~Q4'
  const quarter = QUARTER_END_MONTH[quarterParam] ? quarterParam : 'Q1~Q4'
  const quarterEndMonth = QUARTER_END_MONTH[quarter]
  const quarterCount = QUARTER_COUNT[quarter]
  // [2026/08/19] - Lisa - 年度／員工篩選比照畫面上「歷史年度目標查詢」頁籤的篩選條件，匯出結果與畫面一致
  const yearParam = searchParams.get('year') ? parseInt(searchParams.get('year')!) : null
  const employeeIdParam = searchParams.get('employeeId') ? parseInt(searchParams.get('employeeId')!) : null

  const targets = await prisma.feeTarget.findMany({
    where: {
      employeeId: { in: subIds },
      ...(yearParam ? { year: yearParam } : {}),
      ...(employeeIdParam ? { employeeId: employeeIdParam } : {}),
    },
    include: {
      employee: { select: { name: true } },
      setter: { select: { name: true } },
    },
    orderBy: [{ year: 'desc' }, { employeeId: 'asc' }],
  })
  const actuals = await calcActuals(subIds, [...new Set(targets.map((t) => t.year))], quarterEndMonth)
  const empMap = new Map(subordinates.map((s) => [s.id, s]))
  const empOrder = new Map(subordinates.map((s, i) => [s.id, i]))

  const rows = targets
    .map((t) => {
      const actual = actuals.get(`${t.employeeId}-${t.year}`)
      const emp = empMap.get(t.employeeId)
      return {
        employeeId: t.employeeId,
        employeeName: t.employee.name,
        departmentName: emp?.departmentName ?? '',
        teamGroup: emp?.teamGroup ?? null,
        year: t.year,
        targetAmount: t.targetAmount != null ? Math.round((t.targetAmount / 4) * quarterCount) : null,
        targetCaseCount: t.targetCaseCount != null ? Math.round((t.targetCaseCount / 4) * quarterCount) : null,
        actualFee: actual?.fee ?? 0,
        actualCaseCount: actual?.count ?? 0,
        setByName: t.setter.name,
        setAt: t.setAt,
      }
    })
    .sort(
      (a, b) =>
        b.year - a.year ||
        (empOrder.get(a.employeeId) ?? 0) - (empOrder.get(b.employeeId) ?? 0)
    )

  const quarterSuffix = quarter !== 'Q1~Q4' ? `（${quarter}換算）` : ''
  const actualSuffix = quarter !== 'Q1~Q4' ? `（${quarter}）` : ''

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('歷史年度目標查詢')
  ws.columns = [
    { header: '部門', key: 'departmentName', width: 14 },
    { header: '組別', key: 'teamGroup', width: 10 },
    { header: '員工', key: 'employeeName', width: 10 },
    { header: '年度', key: 'year', width: 8 },
    { header: `公證費目標${quarterSuffix}`, key: 'targetAmount', width: 16 },
    { header: `結案件數(主辦)目標${quarterSuffix}`, key: 'targetCaseCount', width: 18 },
    { header: `實際公證費${actualSuffix}`, key: 'actualFee', width: 14 },
    { header: '達成率(金額)', key: 'pctFee', width: 12 },
    { header: `實際結案數(主辦)${actualSuffix}`, key: 'actualCaseCount', width: 16 },
    { header: '達成率(件數)', key: 'pctCount', width: 12 },
    { header: '設定人', key: 'setByName', width: 10 },
    { header: '設定日期', key: 'setAt', width: 12 },
  ]
  const colCount = ws.columns.length
  styleHeaderRow(ws.getRow(1), colCount)

  const grand = { targetAmount: 0, targetCaseCount: 0, actualFee: 0, actualCaseCount: 0 }
  rows.forEach((r) => {
    const pctFee = r.targetAmount ? Math.round((r.actualFee / r.targetAmount) * 100) : null
    const pctCount = r.targetCaseCount ? Math.round((r.actualCaseCount / r.targetCaseCount) * 100) : null
    const row = ws.addRow({
      departmentName: r.departmentName || '—',
      teamGroup: r.teamGroup || '—',
      employeeName: r.employeeName,
      year: `${r.year} 年`,
      targetAmount: r.targetAmount ?? null,
      targetCaseCount: r.targetCaseCount ?? null,
      actualFee: r.actualFee || null,
      pctFee: pctFee != null ? `${pctFee}%` : '—',
      actualCaseCount: r.actualCaseCount || null,
      pctCount: pctCount != null ? `${pctCount}%` : '—',
      setByName: r.setByName,
      setAt: dayjs(r.setAt).format('YYYY/MM/DD'),
    })
    styleBody(row, colCount, [5, 7])
    grand.targetAmount += r.targetAmount ?? 0
    grand.targetCaseCount += r.targetCaseCount ?? 0
    grand.actualFee += r.actualFee
    grand.actualCaseCount += r.actualCaseCount
  })

  // 合計列
  const totalPctFee = grand.targetAmount ? Math.round((grand.actualFee / grand.targetAmount) * 100) : null
  const totalPctCount = grand.targetCaseCount ? Math.round((grand.actualCaseCount / grand.targetCaseCount) * 100) : null
  const total = ws.addRow({
    departmentName: `合計（${rows.length} 筆）`,
    targetAmount: grand.targetAmount || null,
    targetCaseCount: grand.targetCaseCount || null,
    actualFee: grand.actualFee || null,
    pctFee: totalPctFee != null ? `${totalPctFee}%` : '—',
    actualCaseCount: grand.actualCaseCount || null,
    pctCount: totalPctCount != null ? `${totalPctCount}%` : '—',
  })
  ws.mergeCells(total.number, 1, total.number, 3)
  styleBody(total, colCount, [5, 7])
  total.font = { bold: true }
  for (let col = 1; col <= colCount; col++) total.getCell(col).fill = TOTAL_FILL

  // 表格下方加註
  const note = ws.addRow([
    `註：達成率＝依所選累計季度換算目標與實績計算（目標＝原年度目標 ÷4×季數，實績限縮至對應累計月份；Q1~Q4 即全年，與改版前一致）；金額依承辦比例分攤，件數僅計主辦。統計範圍：${quarter}${yearParam ? `／${yearParam} 年` : '／全部年度'}。`,
  ])
  ws.mergeCells(note.number, 1, note.number, colCount)
  note.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF888888' } }
  note.getCell(1).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }

  ws.views = [{ state: 'frozen', ySplit: 1 }]

  const buffer = await wb.xlsx.writeBuffer()
  const yearLabel = yearParam ? `${yearParam}` : '全部年度'
  const filename = `純公證費業績歷史目標_${yearLabel}_${quarter}_${taipeiNow().format('YYYYMMDD')}.xlsx`
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="performance-history.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
