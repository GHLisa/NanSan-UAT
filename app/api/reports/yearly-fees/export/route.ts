import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import ExcelJS from 'exceljs'
import dayjs from 'dayjs'

export const runtime = 'nodejs'

// [2026/07/02] - Lisa - 開放行政人員匯出：各年度已決&未決公證費（全公司範圍）
const ALLOWED_ROLES = ['team_lead', 'dept_manager', 'vp', 'sysadmin', 'admin_staff']

const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9E1F2' } }
const SUM_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFAFAFA' } }
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

  // ── 角色可見範圍 WHERE（與 GET /api/reports/yearly-fees 相同）────────────
  // [2026/07/02] - Lisa - 行政人員比照 vp/sysadmin 視為全公司範圍（可查任一部門）
  const isWideRole = canViewAllDepts(role) || role === 'admin_staff'
  const scopeWhere: Record<string, unknown> = { departmentId: deptId }
  if (!isWideRole && departmentId && departmentId !== deptId) {
    return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 })
  }

  const cases = await prisma.case.findMany({
    where: scopeWhere,
    select: {
      id: true, commissionDate: true, status: true,
      actualFee: true, estimatedFee: true,
      assignments: { select: { employeeId: true } },
    },
  })

  const deptEmpIds = Array.from(new Set(employeeRoles.filter(r => r.departmentId === deptId).map(r => r.employeeId)))
  const deptEmployees = deptEmpIds
    .filter(id => empMap.has(id))
    .map(id => ({ id, name: empMap.get(id)! }))
    .sort((a, b) => a.id - b.id)

  const years = Array.from(new Set(cases.map(c => dayjs(c.commissionDate).year()))).sort((a, b) => b - a)

  const rows = years.map(year => {
    const yearCases = cases.filter(c => dayjs(c.commissionDate).year() === year)
    const closed = yearCases.filter(c => c.status === '已決')
    const open = yearCases.filter(c => c.status === '未決')
    const empCounts = new Map<number, number>()
    for (const emp of deptEmployees) {
      empCounts.set(emp.id, yearCases.filter(c => c.assignments.some(a => a.employeeId === emp.id)).length)
    }
    return {
      year: `${year} 年`,
      total: yearCases.length,
      closedCnt: closed.length,
      openCnt: open.length,
      closedFee: closed.reduce((s, c) => s + (c.actualFee ?? 0), 0),
      openFee: open.reduce((s, c) => s + (c.estimatedFee ?? 0), 0),
      empCounts,
    }
  })

  const deptName = departments.find(d => d.id === deptId)?.name ?? ''

  // ── 建立 Excel ─────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('各年度公證費統計')
  const FIXED = 6 // 年度/接案量/已決件數/未決件數/已決公證費/未決公證費
  const colCount = FIXED + deptEmployees.length

  // 欄寬
  const fixedWidths = [10, 9, 10, 10, 16, 18]
  fixedWidths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
  deptEmployees.forEach((_, i) => { ws.getColumn(FIXED + 1 + i).width = 10 })

  // 第 1 列：標題
  ws.mergeCells(1, 1, 1, colCount)
  const titleCell = ws.getCell(1, 1)
  titleCell.value = `${deptName} — 各年度已決&未決公證費及接案統計`
  titleCell.font = { bold: true, size: 13 }
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(1).height = 26

  // 第 2~3 列：表頭（固定欄跨兩列，員工欄歸於「接案件數」群組）
  const fixedHeaders = ['年度', '接案量', '已決件數', '未決件數', '已決公證費', '未決公證費（預估）']
  fixedHeaders.forEach((h, i) => {
    ws.mergeCells(2, i + 1, 3, i + 1)
    ws.getCell(2, i + 1).value = h
  })
  if (deptEmployees.length) {
    ws.mergeCells(2, FIXED + 1, 2, colCount)
    ws.getCell(2, FIXED + 1).value = '接案件數（不限主辦／協辦）'
    deptEmployees.forEach((emp, i) => { ws.getCell(3, FIXED + 1 + i).value = emp.name })
  }
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
    dr.getCell(2).value = row.total || null
    dr.getCell(3).value = row.closedCnt || null
    dr.getCell(4).value = row.openCnt || null
    dr.getCell(5).value = row.closedFee || null
    dr.getCell(6).value = row.openFee || null
    deptEmployees.forEach((emp, j) => {
      const v = row.empCounts.get(emp.id) ?? 0
      dr.getCell(FIXED + 1 + j).value = v || null
    })
    dr.alignment = { vertical: 'middle', horizontal: 'center' }
    dr.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }
    for (const col of [5, 6]) {
      dr.getCell(col).numFmt = '#,##0'
      dr.getCell(col).alignment = { vertical: 'middle', horizontal: 'right' }
    }
    for (let col = 1; col <= colCount; col++) dr.getCell(col).border = THIN_BORDER
  })

  // 合計列
  const sumR = rows.length + 4
  const sr = ws.getRow(sumR)
  sr.getCell(1).value = '合計'
  sr.getCell(2).value = rows.reduce((s, r) => s + r.total, 0) || null
  sr.getCell(3).value = rows.reduce((s, r) => s + r.closedCnt, 0) || null
  sr.getCell(4).value = rows.reduce((s, r) => s + r.openCnt, 0) || null
  sr.getCell(5).value = rows.reduce((s, r) => s + r.closedFee, 0) || null
  sr.getCell(6).value = rows.reduce((s, r) => s + r.openFee, 0) || null
  deptEmployees.forEach((emp, j) => {
    sr.getCell(FIXED + 1 + j).value = rows.reduce((s, r) => s + (r.empCounts.get(emp.id) ?? 0), 0) || null
  })
  sr.font = { bold: true }
  sr.alignment = { vertical: 'middle', horizontal: 'center' }
  sr.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }
  for (const col of [5, 6]) {
    sr.getCell(col).numFmt = '#,##0'
    sr.getCell(col).alignment = { vertical: 'middle', horizontal: 'right' }
  }
  for (let col = 1; col <= colCount; col++) {
    sr.getCell(col).fill = SUM_FILL
    sr.getCell(col).border = THIN_BORDER
  }

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }]

  const buffer = await wb.xlsx.writeBuffer()
  const filename = `各年度已決未決公證費_${deptName}_${dayjs().format('YYYYMMDD')}.xlsx`
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="yearly-fees.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
