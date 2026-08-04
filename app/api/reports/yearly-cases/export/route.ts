import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { caseReportYear } from '@/lib/caseYear'
import ExcelJS from 'exceljs'
// [2026/08/05] - Lisa - 檔名日期取台北時間（伺服器 UTC 於台北 00:00~08:00 會標成前一日）
import { taipeiNow } from '@/lib/sla'

export const runtime = 'nodejs'

// [2026/07/02] - Lisa - 開放行政人員匯出：各年度已決&未決案件數（全公司範圍）
const ALLOWED_ROLES = ['team_lead', 'dept_manager', 'vp', 'sysadmin', 'admin_staff']

const STATUS_LABEL: Record<string, string> = {
  all: '全部案件', 已決: '已決', 未決: '未決',
}

// 表頭與資料列共用底色/框線設定（彷照 cases/export 樣式）
const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9E1F2' } }
const THIN_BORDER = {
  top: { style: 'thin' as const }, left: { style: 'thin' as const },
  bottom: { style: 'thin' as const }, right: { style: 'thin' as const },
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })
  if (!ALLOWED_ROLES.includes(session.role)) {
    return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const deptId = searchParams.get('deptId') ? parseInt(searchParams.get('deptId')!) : null
  const status = searchParams.get('status') ?? 'all'  // 'all' | '已決' | '未決'
  const empId = parseInt(session.sub)
  const { role, departmentId } = session

  // ── 角色可見範圍 WHERE（與 GET /api/reports/yearly-cases 相同）────────────
  // [2026/07/02] - Lisa - 行政人員比照 vp/sysadmin 視為全公司範圍（不加部門條件）
  const isWideRole = canViewAllDepts(role) || role === 'admin_staff'
  const scopeWhere: Record<string, unknown> = {}
  if (!isWideRole) {
    if (role === 'handler') {
      scopeWhere.assignments = { some: { employeeId: empId } }
    } else if (departmentId) {
      scopeWhere.departmentId = departmentId
    }
  }
  if (status !== 'all') scopeWhere.status = status

  const cases = await prisma.case.findMany({
    where: scopeWhere,
    select: {
      id: true,
      departmentId: true,
      caseNumber: true,
      commissionDate: true,
      status: true,
      assignments: { select: { employeeId: true, role: true } },
    },
  })

  const [departments, employees, employeeRoles] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employee.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employeeRole.findMany({ select: { employeeId: true, departmentId: true, teamGroup: true } }),
  ])

  const empMap = new Map(employees.map(e => [e.id, e.name]))
  const statusLabel = STATUS_LABEL[status] ?? '全部案件'

  const wb = new ExcelJS.Workbook()

  // 將「年度/部門 + 員工... + 小計 + 合計列」資料寫入一個工作表
  function writeSheet(
    sheetName: string,
    title: string,
    firstColHeader: string,
    firstColWidth: number,
    totalColHeader: string,
    sheetEmployees: { id: number; name: string }[],
    rows: { firstCol: string; counts: Map<number, number>; total: number }[],
  ) {
    const ws = wb.addWorksheet(sheetName)
    const colCount = 1 + sheetEmployees.length + 1 // 首欄 + 員工欄 + 小計欄

    // 欄寬
    ws.getColumn(1).width = firstColWidth
    sheetEmployees.forEach((_, i) => { ws.getColumn(i + 2).width = 10 })
    ws.getColumn(colCount).width = 12

    // 第 1 列：標題（跨欄置中）
    ws.mergeCells(1, 1, 1, colCount)
    const titleCell = ws.getCell(1, 1)
    titleCell.value = title
    titleCell.font = { bold: true, size: 13 }
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' }
    ws.getRow(1).height = 26

    // 第 2 列：表頭
    const headerRow = ws.getRow(2)
    headerRow.getCell(1).value = firstColHeader
    sheetEmployees.forEach((emp, i) => { headerRow.getCell(i + 2).value = emp.name })
    headerRow.getCell(colCount).value = totalColHeader
    headerRow.height = 24
    headerRow.font = { bold: true, size: 11 }
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    for (let col = 1; col <= colCount; col++) {
      headerRow.getCell(col).fill = HEADER_FILL
      headerRow.getCell(col).border = THIN_BORDER
    }

    // 資料列（自第 3 列起）
    rows.forEach((row, i) => {
      const r = i + 3
      const dataRow = ws.getRow(r)
      dataRow.getCell(1).value = row.firstCol
      sheetEmployees.forEach((emp, j) => {
        const count = row.counts.get(emp.id) ?? 0
        dataRow.getCell(j + 2).value = count > 0 ? count : null
      })
      dataRow.getCell(colCount).value = row.total > 0 ? row.total : null
      dataRow.alignment = { vertical: 'middle', horizontal: 'center' }
      dataRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }
      for (let col = 1; col <= colCount; col++) dataRow.getCell(col).border = THIN_BORDER
    })

    // 合計列
    const sumR = rows.length + 3
    const sumRow = ws.getRow(sumR)
    sumRow.getCell(1).value = '合計'
    sheetEmployees.forEach((emp, j) => {
      const colSum = rows.reduce((s, row) => s + (row.counts.get(emp.id) ?? 0), 0)
      sumRow.getCell(j + 2).value = colSum > 0 ? colSum : null
    })
    const grandTotal = rows.reduce((s, row) => s + row.total, 0)
    sumRow.getCell(colCount).value = grandTotal > 0 ? grandTotal : null
    sumRow.font = { bold: true }
    sumRow.alignment = { vertical: 'middle', horizontal: 'center' }
    sumRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }
    for (let col = 1; col <= colCount; col++) {
      sumRow.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } }
      sumRow.getCell(col).border = THIN_BORDER
    }

    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }]
  }

  // ── 工作表 1：各年度員工接案件數（限選定部門）────────────────────────────
  if (deptId) {
    const deptName = departments.find(d => d.id === deptId)?.name ?? ''
    const deptEmpIds = Array.from(new Set(employeeRoles.filter(r => r.departmentId === deptId).map(r => r.employeeId)))
    const deptEmployees = deptEmpIds
      .filter(id => empMap.has(id))
      .map(id => ({ id, name: empMap.get(id)! }))
      .sort((a, b) => a.id - b.id)

    const deptCases = cases.filter(c => c.departmentId === deptId)
    // 年度以公證編號為準（無法解析時回退委託日期年度）
    const years = Array.from(new Set(deptCases.map(c => caseReportYear(c.caseNumber, c.commissionDate)))).sort((a, b) => b - a)

    const rows = years.map(year => {
      const yearCases = deptCases.filter(c => caseReportYear(c.caseNumber, c.commissionDate) === year)
      const counts = new Map<number, number>()
      let total = 0
      for (const emp of deptEmployees) {
        // [2026/07/14] - Lisa - 件數僅歸主辦，協辦不列入計算
        const count = yearCases.filter(c => c.assignments.some(a => a.employeeId === emp.id && a.role === '主辦')).length
        counts.set(emp.id, count)
        total += count
      }
      return { firstCol: `${year} 年`, counts, total }
    })

    writeSheet(
      '各年度員工接案件數',
      `各年度員工接案件數（${deptName}）　統計範圍：${statusLabel}`,
      '公證編號年度', 16, '年度小計', deptEmployees, rows,
    )
  }

  // ── 工作表 2：各部門各員工接案件數（累計）────────────────────────────────
  // 僅計主辦（協辦不列入計算）
  const activeCaseEmpIds = new Set(cases.flatMap(c => c.assignments.filter(a => a.role === '主辦').map(a => a.employeeId)))
  const activeEmployees = employees
    .filter(e => activeCaseEmpIds.has(e.id))
    .sort((a, b) => a.id - b.id)

  const deptRows = departments
    .map(dept => {
      const deptCaseIds = new Set(cases.filter(c => c.departmentId === dept.id).map(c => c.id))
      const counts = new Map<number, number>()
      let total = 0
      for (const emp of activeEmployees) {
        const count = cases.filter(c => deptCaseIds.has(c.id) && c.assignments.some(a => a.employeeId === emp.id && a.role === '主辦')).length
        counts.set(emp.id, count)
        total += count
      }
      return { firstCol: dept.name, counts, total }
    })
    .filter(r => r.total > 0)

  writeSheet(
    '各部門各員工接案件數',
    `各部門各員工接案件數（累計）　統計範圍：${statusLabel}`,
    '部門', 16, '部門合計', activeEmployees, deptRows,
  )

  const buffer = await wb.xlsx.writeBuffer()
  const filename = `年度案件統計_${taipeiNow().format('YYYYMMDD')}.xlsx`

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="yearly-cases.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
