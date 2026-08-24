import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { splitFeeByRatio } from '@/lib/feeSplit'
import { getPrepaidTotals, getPrepayEventsInRange, type PrepayEvent } from '@/lib/feeRecognition'
import { prisma } from '@/lib/prisma'
import ExcelJS from 'exceljs'
import dayjs from 'dayjs'
// [2026/08/05] - Lisa - 檔名日期取台北時間（伺服器 UTC 於台北 00:00~08:00 會標成前一日）
import { taipeiNow } from '@/lib/sla'

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
// [2026/08/04] - Lisa - FR-109 caseCount＝參與人次（月明細小計用）／primaryCount＝主辦件數（季統計用）
type EmpGroup = { empId: number; empName: string; cases: CaseRow[]; totals: { caseCount: number; primaryCount: number; actualFee: number; travelFee: number; subtotalFee: number } }

type RowAssignment = { employeeId: number; role: string; contributionRatio: number | null; employee: { name: string } }
// [2026/08/21] - Lisa - 公證費預付請款依出具日期認列：已決案結案淨額列與預付請款認列列，
// 統一轉成同一種列形狀後再交給 groupByHandler 分組小計，兩者共用同一套分攤邏輯。
type Row = {
  id: number; caseNumber: string; insuredName: string
  date: Date; amount: number; travelFee: number; remarks: string
  assignments: RowAssignment[]
}

function buildRemarks(refDeptId: number | null, caseDepartmentId: number, caseDepartmentName: string, assignments: RowAssignment[]) {
  const ratioText = assignments.length > 1
    ? assignments.map(a => `${a.employee.name} ${Math.round((a.contributionRatio ?? 0) * 100)}%`).join('/')
    : ''
  const deptTag = refDeptId && caseDepartmentId !== refDeptId ? `[${caseDepartmentName}]` : ''
  return [deptTag, ratioText].filter(Boolean).join(' ')
}

async function toPrepayRows(events: PrepayEvent[], refDeptId: number | null): Promise<Row[]> {
  const caseIds = [...new Set(events.map((e) => e.caseId))]
  if (caseIds.length === 0) return []
  const caseInfos = await prisma.case.findMany({
    where: { id: { in: caseIds } },
    select: { id: true, caseNumber: true, insuredName: true, departmentId: true, department: { select: { name: true } } },
  })
  const caseInfoMap = new Map(caseInfos.map((c) => [c.id, c]))
  const rows: Row[] = []
  for (const e of events) {
    const info = caseInfoMap.get(e.caseId)
    if (!info) continue
    const ratioText = e.assignments.length > 1
      ? e.assignments.map(a => `${a.employee.name} ${Math.round((a.contributionRatio ?? 0) * 100)}%`).join('/')
      : ''
    const deptTag = refDeptId && info.departmentId !== refDeptId ? `[${info.department.name}]` : ''
    rows.push({
      id: info.id,
      caseNumber: info.caseNumber,
      insuredName: info.insuredName,
      date: e.issuedAt,
      amount: e.amount,
      travelFee: 0,
      remarks: [deptTag, '公證費預付請款', ratioText].filter(Boolean).join(' '),
      assignments: e.assignments,
    })
  }
  return rows
}

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
  // [2026/08/04] - Lisa - FR-107 統計範圍切換（與 GET /api/reports/case-detail 相同）：
  //   'dept'（預設）＝限案件承辦部門；'share'＝含本單位人員於他部門協辦之份額
  const scopeMode = searchParams.get('scopeMode') === 'share' ? 'share' : 'dept'
  const scopeModeLabel = scopeMode === 'share'
    ? '含本單位人員於他部門協辦之案件（僅列其份額）'
    : '限案件承辦部門'
  // [2026/08/04] - Lisa - FR-107：備註僅標註「非本單位」之案件承辦部門（比對基準與查詢 API 相同）
  const refDeptId = (canViewAllDepts(role) || role === 'admin_staff') ? deptId : departmentId

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

  // [2026/08/21] - Lisa - roleScopeWhere 不含 status/closeDate，供公證費預付請款查詢
  // （不限案件是否已結案）沿用同一套角色可視範圍邏輯；scopeWhere 為已決案件查詢專用。
  const roleScopeWhere: Record<string, unknown> = {}
  // [2026/07/28] - Lisa - 可顯示的承辦人（null = 不限）：組長僅列同組同事，
  // 他組承辦人的分攤列不顯示（分攤金額仍以案件全部承辦人為計算基準，個人份額不受影響）
  let visibleEmpIds: Set<number> | null = null
  if (role === 'handler') {
    // [2026/07/28] - Lisa - 承辦人不限部門：可能於他部門協辦，加部門條件會漏掉跨部門協辦案
    //（對齊 api/cases Issue #5 的處理）；且僅列自己的分攤列，不顯示共同承辦人的列
    roleScopeWhere.assignments = { some: { employeeId: empId } }
    visibleEmpIds = new Set([empId])
  } else if (canViewAllDepts(role) || role === 'admin_staff') {
    // [2026/07/07] - Lisa - 行政人員比照副總：全公司範圍，可依部門查詢條件篩選
    // [2026/08/04] - Lisa - FR-107：選定部門時可切換範圍定義；未選部門（全部部門）時兩者等價
    if (deptId) {
      if (scopeMode === 'share') {
        const roles = await prisma.employeeRole.findMany({
          where: { departmentId: deptId, isPrimary: true },
          select: { employeeId: true },
        })
        const ids = [...new Set(roles.map((r) => r.employeeId))]
        roleScopeWhere.assignments = { some: { employeeId: { in: ids } } }
        visibleEmpIds = new Set(ids)
      } else {
        roleScopeWhere.departmentId = deptId
      }
    }
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
    roleScopeWhere.assignments = { some: { employeeId: { in: groupEmpIds } } }
    visibleEmpIds = new Set(groupEmpIds)
    // [2026/08/04] - Lisa - FR-107：'dept' 模式再加上「案屬本部門」限制（顯示列仍僅同組人員）
    if (scopeMode === 'dept') roleScopeWhere.departmentId = departmentId
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
    roleScopeWhere.assignments = { some: { employeeId: { in: deptEmpIds } } }
    visibleEmpIds = new Set(deptEmpIds)
    // [2026/08/04] - Lisa - FR-107：'dept' 模式再加上「案屬本部門」限制（顯示列仍僅本部門人員）
    if (scopeMode === 'dept') roleScopeWhere.departmentId = departmentId
  }

  const scopeWhere: Record<string, unknown> = { status: '已決', closeDate: closeDateWhere, ...roleScopeWhere }

  const cases = await prisma.case.findMany({
    where: scopeWhere,
    select: {
      id: true, caseNumber: true, insuredName: true, closeDate: true,
      actualFee: true, travelOtherExpense: true,
      // [2026/08/04] - Lisa - FR-107：備註欄標記案件承辦部門（僅非本單位案件）
      departmentId: true,
      department: { select: { name: true } },
      assignments: { select: { employeeId: true, role: true, contributionRatio: true, employee: { select: { name: true } } } },
    },
    orderBy: { closeDate: 'asc' },
  })

  // [2026/08/21] - Lisa - 已決案結案月淨額＝actualFee − 該案累計已依出具日期認列的公證費預付請款
  const prepaidTotals = await getPrepaidTotals(cases.map((c) => c.id))
  const closedRows: Row[] = cases.map((c) => ({
    id: c.id,
    caseNumber: c.caseNumber,
    insuredName: c.insuredName,
    date: c.closeDate!,
    amount: (c.actualFee ?? 0) - (prepaidTotals.get(c.id) ?? 0),
    travelFee: c.travelOtherExpense ?? 0,
    remarks: buildRemarks(refDeptId, c.departmentId, c.department.name, c.assignments),
    assignments: c.assignments,
  }))

  // [2026/07/14] - Lisa - 純公證費/差旅其他費/小計依承辦比例分配；每位經辦人（主辦＋協辦）各列其份額，同一案分列各人，件數依參與人計
  function groupByHandler(list: Row[], withCaseRows: boolean): EmpGroup[] {
    const map = new Map<number, EmpGroup>()
    for (const row of list) {
      // 純公證費依承辦比例分攤（非主辦捨去、主辦吸收剩餘）
      const feeAmts = splitFeeByRatio(row.amount, row.assignments, x => x.contributionRatio ?? 0, x => x.role === '主辦')
      row.assignments.forEach((a, ai) => {
        if (visibleEmpIds && !visibleEmpIds.has(a.employeeId)) return // 組長：不列他組承辦人
        const actualFee = feeAmts[ai]
        const travelFee = a.role === '主辦' ? row.travelFee : 0
        const subtotalFee = actualFee + travelFee
        if (!map.has(a.employeeId)) {
          map.set(a.employeeId, {
            empId: a.employeeId, empName: a.employee.name,
            cases: [], totals: { caseCount: 0, primaryCount: 0, actualFee: 0, travelFee: 0, subtotalFee: 0 },
          })
        }
        const g = map.get(a.employeeId)!
        if (withCaseRows) {
          g.cases.push({
            id: row.id, caseNumber: row.caseNumber, insuredName: row.insuredName,
            closeDate: row.date.toISOString(), actualFee, travelFee, subtotalFee, remarks: row.remarks,
          })
        }
        g.totals.caseCount++
        // [2026/08/04] - Lisa - FR-109 主辦件數（季統計工作表用）
        if (a.role === '主辦') g.totals.primaryCount++
        g.totals.actualFee += actualFee
        g.totals.travelFee += travelFee
        g.totals.subtotalFee += subtotalFee
      })
    }
    return Array.from(map.values())
  }

  const wb = new ExcelJS.Workbook()

  if (type === 'monthly') {
    // [2026/08/21] - Lisa - 公證費預付請款：依出具日期併入同一期間的統計（不限案件是否已結案）
    const prepayEvents = await getPrepayEventsInRange(roleScopeWhere as unknown as Prisma.CaseWhereInput, closeDateWhere)
    const prepayRows = await toPrepayRows(prepayEvents, refDeptId)
    buildDetailSheet(wb, `${year}年${month}月 已決案明細`, groupByHandler([...closedRows, ...prepayRows], true), scopeModeLabel)
  } else {
    const prepayEvents = await getPrepayEventsInRange(roleScopeWhere as unknown as Prisma.CaseWhereInput, closeDateWhere)
    const prepayRows = await toPrepayRows(prepayEvents, refDeptId)
    buildQuarterSheet(wb, `${year}年${quarter}已決案統計`, groupByHandler([...closedRows, ...prepayRows], false), scopeModeLabel)

    // YTD（Q1 ~ 當季）
    const qMonths = QUARTER_MONTHS[quarter] ?? [1, 2, 3]
    const ytdStart = new Date(`${year}-01-01`)
    const ytdEnd = dayjs(`${year}-${String(qMonths[qMonths.length - 1]).padStart(2, '0')}-01`).endOf('month')
    const ytdRange = { gte: ytdStart, lte: ytdEnd.toDate() }
    const ytdCases = await prisma.case.findMany({
      where: { ...scopeWhere, closeDate: ytdRange },
      select: {
        id: true, caseNumber: true, insuredName: true, closeDate: true,
        actualFee: true, travelOtherExpense: true,
        departmentId: true, // [2026/08/04] - Lisa - FR-107：與主查詢欄位一致（groupByHandler 共用）
        department: { select: { name: true } },
        assignments: { select: { employeeId: true, role: true, contributionRatio: true, employee: { select: { name: true } } } },
      },
    })
    const ytdPrepaidTotals = await getPrepaidTotals(ytdCases.map((c) => c.id))
    const ytdClosedRows: Row[] = ytdCases.map((c) => ({
      id: c.id,
      caseNumber: c.caseNumber,
      insuredName: c.insuredName,
      date: c.closeDate!,
      amount: (c.actualFee ?? 0) - (ytdPrepaidTotals.get(c.id) ?? 0),
      travelFee: c.travelOtherExpense ?? 0,
      remarks: buildRemarks(refDeptId, c.departmentId, c.department.name, c.assignments),
      assignments: c.assignments,
    }))
    const ytdPrepayEvents = await getPrepayEventsInRange(roleScopeWhere as unknown as Prisma.CaseWhereInput, ytdRange)
    const ytdPrepayRows = await toPrepayRows(ytdPrepayEvents, refDeptId)
    buildQuarterSheet(wb, `Q1~${quarter}累計`, groupByHandler([...ytdClosedRows, ...ytdPrepayRows], false), scopeModeLabel)
  }

  const buffer = await wb.xlsx.writeBuffer()
  const label = type === 'monthly' ? `${year}${String(month).padStart(2, '0')}` : `${year}${quarter}`
  const filename = `已決案明細表_${label}_${taipeiNow().format('YYYYMMDD')}.xlsx`
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="case-detail.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}

// ── 月明細：依經辦人分組逐筆列出，每組小計，末列總計 ──────────────────────
function buildDetailSheet(wb: ExcelJS.Workbook, sheetName: string, groups: EmpGroup[], scopeModeLabel: string) {
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
  // [2026/08/04] - Lisa - FR-107：加註本次統計範圍與備註欄部門標記說明（匯出檔可獨立判讀）
  const note = ws.addRow([`註：純公證費依承辦比例分配至各經辦人、差旅其他費歸主辦；同一案分列於各經辦人，件數依參與人計。備註欄 [ ] 為非本單位之案件承辦部門；「公證費預付請款」列依出具日期認列，結案月已扣除累計預付金額（可能為負）。統計範圍：${scopeModeLabel}。`])
  ws.mergeCells(note.number, 1, note.number, 9)
  note.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF888888' } }
  note.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }

  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

// ── 季統計：每位經辦人一列（件數/純公證費/差旅其他費/小計）+ 合計 ─────────
function buildQuarterSheet(wb: ExcelJS.Workbook, sheetName: string, groups: EmpGroup[], scopeModeLabel: string) {
  const ws = wb.addWorksheet(sheetName)
  ws.columns = [
    { header: '序', key: 'seq', width: 6 },
    { header: '經辦人', key: 'empName', width: 14 },
    // [2026/08/04] - Lisa - FR-109 季統計件數只計主辦（協辦不計件，仍計金額份額）
    { header: '件數(主辦)', key: 'caseCount', width: 12 },
    { header: '純公證費', key: 'actualFee', width: 16 },
    { header: '差旅其他費', key: 'travelFee', width: 14 },
    { header: '小計', key: 'subtotalFee', width: 16 },
  ]
  styleHeaderRow(ws.getRow(1), 6)

  const grand = { caseCount: 0, actualFee: 0, travelFee: 0, subtotalFee: 0 }
  groups.forEach((g, i) => {
    const row = ws.addRow({
      // [2026/08/04] - Lisa - FR-109 件數欄改用 primaryCount（主辦件數）
      seq: i + 1, empName: g.empName, caseCount: g.totals.primaryCount || null,
      actualFee: g.totals.actualFee || null, travelFee: g.totals.travelFee || null, subtotalFee: g.totals.subtotalFee || null,
    })
    styleBody(row, 6, [4, 5, 6])
    grand.caseCount += g.totals.primaryCount
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
  // [2026/08/04] - Lisa - FR-107：加註本次統計範圍
  const note = ws.addRow([`註：純公證費依承辦比例分配至各經辦人、差旅其他費歸主辦；件數僅計主辦案件（協辦不計件，惟仍計入其金額份額）；公證費預付請款依出具日期認列，結案月已扣除累計預付金額。統計範圍：${scopeModeLabel}。`])
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
