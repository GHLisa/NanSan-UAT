import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { splitFeeByRatio } from '@/lib/feeSplit'
import { prisma } from '@/lib/prisma'
import ExcelJS from 'exceljs'
import dayjs from 'dayjs'

export const runtime = 'nodejs'

const QUARTER_MONTHS: Record<string, number[]> = {
  Q1: [1, 2, 3], Q2: [4, 5, 6], Q3: [7, 8, 9], Q4: [10, 11, 12],
}

const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9E1F2' } }
const SUB_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFDBEAFE' } }
const TOTAL_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF7E6' } }
const THIN_BORDER = {
  top: { style: 'thin' as const }, left: { style: 'thin' as const },
  bottom: { style: 'thin' as const }, right: { style: 'thin' as const },
}

type CaseRow = {
  id: number; caseNumber: string; insuredName: string
  closeDate: string; actualFee: number; travelFee: number; subtotalFee: number; remarks: string
}
type EmpGroup = { empId: number; empName: string; cases: CaseRow[]; totals: { caseCount: number; actualFee: number; travelFee: number; subtotalFee: number } }

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const type = searchParams.get('type') ?? 'monthly' // 'monthly' | 'quarterly'
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()))
  const month = parseInt(searchParams.get('month') ?? String(new Date().getMonth() + 1))
  const quarter = searchParams.get('quarter') ?? 'Q1'
  const deptId = searchParams.get('deptId') ? parseInt(searchParams.get('deptId')!) : null
  const empId = parseInt(session.sub)
  const { role, departmentId, teamGroup } = session

  // ── closeDate 範圍（與 GET /api/reports/case-detail 相同）─────────────────
  let closeDateWhere: { gte: Date; lte: Date }
  if (type === 'monthly') {
    const start = dayjs(`${year}-${String(month).padStart(2, '0')}-01`)
    closeDateWhere = { gte: start.toDate(), lte: start.endOf('month').toDate() }
  } else {
    const months = QUARTER_MONTHS[quarter] ?? [1, 2, 3]
    const m1 = months[0], m2 = months[months.length - 1]
    closeDateWhere = {
      gte: dayjs(`${year}-${String(m1).padStart(2, '0')}-01`).toDate(),
      lte: dayjs(`${year}-${String(m2).padStart(2, '0')}-01`).endOf('month').toDate(),
    }
  }

  const scopeWhere: Record<string, unknown> = { status: '已決', closeDate: closeDateWhere }
  // [2026/07/28] - Lisa - 可顯示的承辦人（null = 不限）：組長僅列同組同事，
  // 他組承辦人的分攤列不顯示（分攤金額仍以案件全部承辦人為計算基準，個人份額不受影響）
  let visibleEmpIds: Set<number> | null = null
  if (role === 'handler') {
    // [2026/07/28] - Lisa - 承辦人不限部門：可能於他部門協辦，加部門條件會漏掉跨部門協辦案
    //（對齊 api/cases Issue #5 的處理）；且僅列自己的分攤列，不顯示共同承辦人的列
    scopeWhere.assignments = { some: { employeeId: empId } }
    visibleEmpIds = new Set([empId])
  } else if (canViewAllDepts(role) || role === 'admin_staff') {
    // [2026/07/07] - Lisa - 行政人員比照副總：全公司範圍，可依部門查詢條件篩選
    if (deptId) scopeWhere.departmentId = deptId
  } else if (role === 'team_lead' && departmentId && teamGroup) {
    // [2026/07/28] - Lisa - 組長：以「同組人員（同部門＋同組別，主要角色）的參與」為準，不限案件承辦部門，
    // 使同組人員在他部門協辦的份額也納入（與部門主管同一套邏輯）；顯示列僅限同組人員。
    // 註：案件管理清單（api/cases buildCaseScope，FR-34）仍維持「案屬本部門」的限制，兩者定義不同——
    // 本報表算的是「本組人員的份額」，非「本部門的案件」。
    const roles = await prisma.employeeRole.findMany({
      where: { departmentId, teamGroup, isPrimary: true },
      select: { employeeId: true },
    })
    const groupEmpIds = [...new Set(roles.map((r) => r.employeeId))]
    scopeWhere.assignments = { some: { employeeId: { in: groupEmpIds } } }
    visibleEmpIds = new Set(groupEmpIds)
  } else if (departmentId) {
    // 組長無組別 / 部門主管
    // [2026/07/28] - Lisa - 範圍改以「本部門人員的參與」為準（不再限案件承辦部門），
    // 使本部門人員在他部門協辦的份額也納入；顯示列仍僅限本部門人員（跨部門協辦者不顯示）。
    // 人員認定採「主要角色（isPrimary）所屬部門」：兼任他部門主管者（如同時掛兩部門主管）
    // 其本職案件應歸主要部門，否則會被重複計入兩個部門的報表。
    const roles = await prisma.employeeRole.findMany({
      where: { departmentId, isPrimary: true },
      select: { employeeId: true },
    })
    const deptEmpIds = [...new Set(roles.map((r) => r.employeeId))]
    scopeWhere.assignments = { some: { employeeId: { in: deptEmpIds } } }
    visibleEmpIds = new Set(deptEmpIds)
  }

  const cases = await prisma.case.findMany({
    where: scopeWhere,
    select: {
      id: true, caseNumber: true, insuredName: true, closeDate: true,
      actualFee: true, travelOtherExpense: true,
      assignments: { select: { employeeId: true, role: true, contributionRatio: true, employee: { select: { name: true } } } },
    },
    orderBy: { closeDate: 'asc' },
  })

  // [2026/07/14] - Lisa - 純公證費/差旅其他費/小計依承辦比例分配；每位經辦人（主辦＋協辦）各列其份額，同一案分列各人，件數依參與人計
  function groupByHandler(list: typeof cases, withCaseRows: boolean): EmpGroup[] {
    const map = new Map<number, EmpGroup>()
    for (const c of list) {
      const travelFeeFull = c.travelOtherExpense ?? 0
      const actualFeeFull = c.actualFee ?? 0
      const remarks = c.assignments.length > 1
        ? c.assignments.map(a => `${a.employee.name} ${Math.round((a.contributionRatio ?? 0) * 100)}%`).join('/')
        : ''
      // 純公證費依承辦比例分攤（非主辦捨去、主辦吸收剩餘）
      const feeAmts = splitFeeByRatio(actualFeeFull, c.assignments, x => x.contributionRatio ?? 0, x => x.role === '主辦')
      c.assignments.forEach((a, ai) => {
        if (visibleEmpIds && !visibleEmpIds.has(a.employeeId)) return // 組長：不列他組承辦人
        const actualFee = feeAmts[ai]
        const travelFee = a.role === '主辦' ? travelFeeFull : 0
        const subtotalFee = actualFee + travelFee
        if (!map.has(a.employeeId)) {
          map.set(a.employeeId, {
            empId: a.employeeId, empName: a.employee.name,
            cases: [], totals: { caseCount: 0, actualFee: 0, travelFee: 0, subtotalFee: 0 },
          })
        }
        const g = map.get(a.employeeId)!
        if (withCaseRows) {
          g.cases.push({
            id: c.id, caseNumber: c.caseNumber, insuredName: c.insuredName,
            closeDate: c.closeDate!.toISOString(), actualFee, travelFee, subtotalFee, remarks,
          })
        }
        g.totals.caseCount++
        g.totals.actualFee += actualFee
        g.totals.travelFee += travelFee
        g.totals.subtotalFee += subtotalFee
      })
    }
    return Array.from(map.values())
  }

  const wb = new ExcelJS.Workbook()

  if (type === 'monthly') {
    buildDetailSheet(wb, `${year}年${month}月 已決案明細`, groupByHandler(cases, true))
  } else {
    buildQuarterSheet(wb, `${year}年${quarter}已決案統計`, groupByHandler(cases, false))

    // YTD（Q1 ~ 當季）
    const qMonths = QUARTER_MONTHS[quarter] ?? [1, 2, 3]
    const ytdEnd = dayjs(`${year}-${String(qMonths[qMonths.length - 1]).padStart(2, '0')}-01`).endOf('month')
    const ytdCases = await prisma.case.findMany({
      where: { ...scopeWhere, closeDate: { gte: new Date(`${year}-01-01`), lte: ytdEnd.toDate() } },
      select: {
        id: true, caseNumber: true, insuredName: true, closeDate: true,
        actualFee: true, travelOtherExpense: true,
        assignments: { select: { employeeId: true, role: true, contributionRatio: true, employee: { select: { name: true } } } },
      },
    })
    buildQuarterSheet(wb, `Q1~${quarter}累計`, groupByHandler(ytdCases, false))
  }

  const buffer = await wb.xlsx.writeBuffer()
  const label = type === 'monthly' ? `${year}${String(month).padStart(2, '0')}` : `${year}${quarter}`
  const filename = `已決案明細表_${label}_${dayjs().format('YYYYMMDD')}.xlsx`
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="case-detail.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}

// ── 月明細：依經辦人分組逐筆列出，每組小計，末列總計 ──────────────────────
function buildDetailSheet(wb: ExcelJS.Workbook, sheetName: string, groups: EmpGroup[]) {
  const ws = wb.addWorksheet(sheetName)
  ws.columns = [
    { header: '序', key: 'seq', width: 6 },
    { header: '公證編號', key: 'caseNumber', width: 22 },
    { header: '被保險人', key: 'insuredName', width: 22 },
    { header: '經辦人', key: 'empName', width: 10 },
    { header: '出報告日期', key: 'closeDate', width: 14 },
    { header: '純公證費', key: 'actualFee', width: 14 },
    { header: '差旅其他費', key: 'travelFee', width: 14 },
    { header: '小計', key: 'subtotalFee', width: 14 },
    { header: '備註', key: 'remarks', width: 24 },
  ]
  styleHeaderRow(ws.getRow(1), 9)

  let seq = 1
  const grand = { caseCount: 0, actualFee: 0, travelFee: 0, subtotalFee: 0 }
  for (const g of groups) {
    const sorted = [...g.cases].sort((a, b) => (a.closeDate ?? '').localeCompare(b.closeDate ?? ''))
    for (const c of sorted) {
      const row = ws.addRow({
        seq: seq++, caseNumber: c.caseNumber, insuredName: c.insuredName, empName: g.empName,
        closeDate: c.closeDate ? dayjs(c.closeDate).format('YYYY/MM/DD') : '—',
        actualFee: c.actualFee || null, travelFee: c.travelFee || null, subtotalFee: c.subtotalFee || null,
        remarks: c.remarks || '',
      })
      styleBody(row, 9, [6, 7, 8])
    }
    // 小計列
    const sub = ws.addRow({
      caseNumber: `小計（${g.totals.caseCount} 件）`,
      actualFee: g.totals.actualFee || null, travelFee: g.totals.travelFee || null, subtotalFee: g.totals.subtotalFee || null,
    })
    styleBody(sub, 9, [6, 7, 8])
    sub.font = { bold: true }
    for (let col = 1; col <= 9; col++) sub.getCell(col).fill = SUB_FILL

    grand.caseCount += g.totals.caseCount
    grand.actualFee += g.totals.actualFee
    grand.travelFee += g.totals.travelFee
    grand.subtotalFee += g.totals.subtotalFee
  }

  // 合計列
  const total = ws.addRow({
    caseNumber: `合計（${grand.caseCount} 件）`,
    actualFee: grand.actualFee || null, travelFee: grand.travelFee || null, subtotalFee: grand.subtotalFee || null,
  })
  styleBody(total, 9, [6, 7, 8])
  total.font = { bold: true }
  for (let col = 1; col <= 9; col++) total.getCell(col).fill = TOTAL_FILL

  // [2026/07/14] - Lisa - 表格下方加註
  const note = ws.addRow(['註：純公證費依承辦比例分配至各經辦人、差旅其他費歸主辦；同一案分列於各經辦人，件數依參與人計。'])
  ws.mergeCells(note.number, 1, note.number, 9)
  note.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF888888' } }
  note.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }

  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

// ── 季統計：每位經辦人一列（件數/純公證費/差旅其他費/小計）+ 合計 ─────────
function buildQuarterSheet(wb: ExcelJS.Workbook, sheetName: string, groups: EmpGroup[]) {
  const ws = wb.addWorksheet(sheetName)
  ws.columns = [
    { header: '序', key: 'seq', width: 6 },
    { header: '經辦人', key: 'empName', width: 14 },
    { header: '件數', key: 'caseCount', width: 8 },
    { header: '純公證費', key: 'actualFee', width: 16 },
    { header: '差旅其他費', key: 'travelFee', width: 14 },
    { header: '小計', key: 'subtotalFee', width: 16 },
  ]
  styleHeaderRow(ws.getRow(1), 6)

  const grand = { caseCount: 0, actualFee: 0, travelFee: 0, subtotalFee: 0 }
  groups.forEach((g, i) => {
    const row = ws.addRow({
      seq: i + 1, empName: g.empName, caseCount: g.totals.caseCount || null,
      actualFee: g.totals.actualFee || null, travelFee: g.totals.travelFee || null, subtotalFee: g.totals.subtotalFee || null,
    })
    styleBody(row, 6, [4, 5, 6])
    grand.caseCount += g.totals.caseCount
    grand.actualFee += g.totals.actualFee
    grand.travelFee += g.totals.travelFee
    grand.subtotalFee += g.totals.subtotalFee
  })

  const total = ws.addRow({
    empName: '合計', caseCount: grand.caseCount || null,
    actualFee: grand.actualFee || null, travelFee: grand.travelFee || null, subtotalFee: grand.subtotalFee || null,
  })
  styleBody(total, 6, [4, 5, 6])
  total.font = { bold: true }
  for (let col = 1; col <= 6; col++) total.getCell(col).fill = TOTAL_FILL

  // [2026/07/14] - Lisa - 表格下方加註
  const note = ws.addRow(['註：純公證費依承辦比例分配至各經辦人、差旅其他費歸主辦；件數依參與人計。'])
  ws.mergeCells(note.number, 1, note.number, 6)
  note.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF888888' } }
  note.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }

  ws.views = [{ state: 'frozen', ySplit: 1 }]
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
