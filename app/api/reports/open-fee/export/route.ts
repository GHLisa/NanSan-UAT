import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { splitFeeByRatio } from '@/lib/feeSplit'
import { prisma } from '@/lib/prisma'
import { caseReportYear } from '@/lib/caseYear'
import ExcelJS from 'exceljs'
import dayjs from 'dayjs'

export const runtime = 'nodejs'

// [2026/07/02] - Lisa - 開放行政人員匯出：各員工未決件數&預估公證費（全公司範圍）
const ALLOWED_ROLES = ['team_lead', 'dept_manager', 'vp', 'sysadmin', 'admin_staff']

const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9E1F2' } }
const SUM_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFAFAFA' } }
const FEE60_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFEBF4FC' } }
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
  const { role, departmentId } = session

  if (!deptId) return NextResponse.json({ success: false, error: '請先選擇部門' }, { status: 400 })

  const [departments, employees, employeeRoles] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employee.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employeeRole.findMany({ select: { employeeId: true, departmentId: true } }),
  ])
  const empMap = new Map(employees.map(e => [e.id, e.name]))

  // ── 角色可見範圍 WHERE（只看未決；與 GET /api/reports/open-fee 相同）──────
  // [2026/07/02] - Lisa - 行政人員比照 vp/sysadmin 視為全公司範圍（可查任一部門）
  const isWideRole = canViewAllDepts(role) || role === 'admin_staff'
  if (!isWideRole && departmentId && departmentId !== deptId) {
    return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 })
  }
  const openCases = await prisma.case.findMany({
    where: { departmentId: deptId, status: '未決' },
    select: {
      id: true, caseNumber: true, commissionDate: true, estimatedFee: true,
      assignments: { select: { employeeId: true, role: true, contributionRatio: true } },
    },
  })

  const deptEmpIds = Array.from(new Set(employeeRoles.filter(r => r.departmentId === deptId).map(r => r.employeeId)))
  const deptEmployees = deptEmpIds
    .filter(id => empMap.has(id))
    .map(id => ({ id, name: empMap.get(id)! }))
    .sort((a, b) => a.id - b.id)

  // 年度以公證編號為準（無法解析時回退委託日期年度）
  const years = Array.from(new Set(openCases.map(c => caseReportYear(c.caseNumber, c.commissionDate)))).sort((a, b) => b - a)

  // 每年每員工：{ cnt, fee }
  const rows = years.map(year => {
    const yearCases = openCases.filter(c => caseReportYear(c.caseNumber, c.commissionDate) === year)
    const per = new Map<number, { cnt: number; fee: number }>()
    let rowCnt = 0, rowFee = 0
    for (const emp of deptEmployees) {
      // [2026/07/14] - Lisa - 未決件數只計主辦；預估公證費依承辦比例分攤（主辦＋協辦各按其比例）
      const cnt = yearCases.filter(c => c.assignments.some(a => a.employeeId === emp.id && a.role === '主辦')).length
      const fee = yearCases.reduce((s, c) => {
        const idx = c.assignments.findIndex(x => x.employeeId === emp.id)
        if (idx < 0) return s
        // 依承辦比例分攤（非主辦捨去、主辦吸收剩餘），取本人份額
        const amts = splitFeeByRatio(c.estimatedFee ?? 0, c.assignments, x => x.contributionRatio ?? 0, x => x.role === '主辦')
        return s + amts[idx]
      }, 0)
      per.set(emp.id, { cnt, fee })
      rowCnt += cnt
      rowFee += fee
    }
    return { year: `${year} 年`, per, rowCnt, rowFee }
  })

  const deptName = departments.find(d => d.id === deptId)?.name ?? ''

  // ── 建立 Excel ─────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('各員工未決統計')
  const colCount = 1 + deptEmployees.length * 2 + 2 // 年度 + 員工×2 + 合計×2

  ws.getColumn(1).width = 14
  deptEmployees.forEach((_, i) => {
    ws.getColumn(2 + i * 2).width = 10      // 未決件數
    ws.getColumn(2 + i * 2 + 1).width = 16  // 預估公證費
  })
  ws.getColumn(colCount - 1).width = 10
  ws.getColumn(colCount).width = 16

  // 第 1 列：標題
  ws.mergeCells(1, 1, 1, colCount)
  const titleCell = ws.getCell(1, 1)
  titleCell.value = `${deptName} — 各員工未決案件統計（訂定下一年度業績目標參考量化數據）`
  titleCell.font = { bold: true, size: 13 }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(1).height = 26

  // 第 2~3 列：兩層表頭
  ws.mergeCells(2, 1, 3, 1)
  ws.getCell(2, 1).value = '公證編號年度'
  deptEmployees.forEach((emp, i) => {
    const c1 = 2 + i * 2
    ws.mergeCells(2, c1, 2, c1 + 1)
    ws.getCell(2, c1).value = emp.name
    ws.getCell(3, c1).value = '未決件數'
    ws.getCell(3, c1 + 1).value = '預估公證費'
  })
  ws.mergeCells(2, colCount - 1, 2, colCount)
  ws.getCell(2, colCount - 1).value = '合計'
  ws.getCell(3, colCount - 1).value = '未決件數'
  ws.getCell(3, colCount).value = '預估公證費'
  for (let r = 2; r <= 3; r++) {
    const hr = ws.getRow(r)
    hr.height = 22
    hr.font = { bold: true, size: 11 }
    hr.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    for (let col = 1; col <= colCount; col++) {
      hr.getCell(col).fill = HEADER_FILL
      hr.getCell(col).border = THIN_BORDER
    }
  }

  // 資料列（自第 4 列起）
  rows.forEach((row, i) => {
    const r = i + 4
    const dr = ws.getRow(r)
    dr.getCell(1).value = row.year
    deptEmployees.forEach((emp, j) => {
      const cell = row.per.get(emp.id)!
      dr.getCell(2 + j * 2).value = cell.cnt || null
      dr.getCell(2 + j * 2 + 1).value = cell.fee || null
    })
    dr.getCell(colCount - 1).value = row.rowCnt || null
    dr.getCell(colCount).value = row.rowFee || null
    styleDataRow(dr)
  })

  // 合計列 + 預估公證費 60% 列
  const totalCnt = new Map<number, number>()
  const totalFee = new Map<number, number>()
  for (const emp of deptEmployees) {
    totalCnt.set(emp.id, rows.reduce((s, r) => s + r.per.get(emp.id)!.cnt, 0))
    totalFee.set(emp.id, rows.reduce((s, r) => s + r.per.get(emp.id)!.fee, 0))
  }
  const grandCnt = rows.reduce((s, r) => s + r.rowCnt, 0)
  const grandFee = rows.reduce((s, r) => s + r.rowFee, 0)

  const sumR = rows.length + 4
  const sr = ws.getRow(sumR)
  sr.getCell(1).value = '合計'
  deptEmployees.forEach((emp, j) => {
    sr.getCell(2 + j * 2).value = totalCnt.get(emp.id) || null
    sr.getCell(2 + j * 2 + 1).value = totalFee.get(emp.id) || null
  })
  sr.getCell(colCount - 1).value = grandCnt || null
  sr.getCell(colCount).value = grandFee || null
  styleDataRow(sr)
  sr.font = { bold: true }
  for (let col = 1; col <= colCount; col++) sr.getCell(col).fill = SUM_FILL

  const fee60R = rows.length + 5
  const fr = ws.getRow(fee60R)
  fr.getCell(1).value = '預估公證費 60%'
  deptEmployees.forEach((emp, j) => {
    fr.getCell(2 + j * 2).value = null
    fr.getCell(2 + j * 2 + 1).value = Math.round((totalFee.get(emp.id) ?? 0) * 0.6) || null
  })
  fr.getCell(colCount - 1).value = null
  fr.getCell(colCount).value = Math.round(grandFee * 0.6) || null
  styleDataRow(fr)
  fr.font = { bold: true, color: { argb: 'FF1B4F8C' } }
  for (let col = 1; col <= colCount; col++) fr.getCell(col).fill = FEE60_FILL

  // [2026/07/14] - Lisa - 表格下方加註
  const noteR = fee60R + 1
  ws.mergeCells(noteR, 1, noteR, colCount)
  const noteCell = ws.getCell(noteR, 1)
  noteCell.value = '註：未決件數僅計主辦；預估公證費依承辦比例分攤。'
  noteCell.font = { size: 9, italic: true, color: { argb: 'FF888888' } }
  noteCell.alignment = { vertical: 'middle', horizontal: 'left' }

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }]

  // 金額欄（每員工第 2 欄 + 合計第 2 欄）千分位 + 右對齊
  function styleDataRow(rowObj: ExcelJS.Row) {
    rowObj.alignment = { vertical: 'middle', horizontal: 'center' }
    rowObj.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }
    const feeCols = [...deptEmployees.map((_, j) => 2 + j * 2 + 1), colCount]
    for (const col of feeCols) {
      rowObj.getCell(col).numFmt = '#,##0'
      rowObj.getCell(col).alignment = { vertical: 'middle', horizontal: 'right' }
    }
    for (let col = 1; col <= colCount; col++) rowObj.getCell(col).border = THIN_BORDER
  }

  const buffer = await wb.xlsx.writeBuffer()
  const filename = `各員工未決件數預估公證費_${deptName}_${dayjs().format('YYYYMMDD')}.xlsx`
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="open-fee.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
