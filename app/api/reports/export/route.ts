import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import ExcelJS from 'exceljs'
import dayjs from 'dayjs'

export const runtime = 'nodejs'

const WIDE_ROLES = ['vp', 'sysadmin', 'admin_staff']

// 表頭與資料列共用底色/框線設定（彷照 cases/export 樣式）
const HEADER_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFD9E1F2' } }
const SUM_FILL = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFAFAFA' } }
const THIN_BORDER = {
  top: { style: 'thin' as const }, left: { style: 'thin' as const },
  bottom: { style: 'thin' as const }, right: { style: 'thin' as const },
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()))
  const reqDeptId = searchParams.get('deptId') ? parseInt(searchParams.get('deptId')!) : null

  const empId = parseInt(session.sub)
  const { role, departmentId, teamGroup } = session
  const isWideRole = WIDE_ROLES.includes(role) || canViewAllDepts(role)

  // ── 取得部門 / 員工 / 員工角色關聯（與 GET /api/reports 相同）──────────────
  const [departments, employees, employeeRoles] = await Promise.all([
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employee.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { id: 'asc' } }),
    prisma.employeeRole.findMany({ select: { employeeId: true, departmentId: true, teamGroup: true } }),
  ])

  const empMap = new Map(employees.map(e => [e.id, e.name]))

  // ── 依角色決定可見員工清單（員工績效用）─────────────────────────────
  let scopedEmpIds: Set<number>
  if (isWideRole) {
    // [2026/07/14] - Lisa - 員工績效：全域角色有選部門則依「員工所屬部門」篩選，未選則全公司
    scopedEmpIds = reqDeptId
      ? new Set(employeeRoles.filter(r => r.departmentId === reqDeptId).map(r => r.employeeId))
      : new Set(employees.map(e => e.id))
  } else if (role === 'handler') {
    scopedEmpIds = new Set([empId])
  } else if (role === 'team_lead') {
    scopedEmpIds = new Set(
      employeeRoles.filter(r => r.departmentId === departmentId && r.teamGroup === teamGroup).map(r => r.employeeId)
    )
  } else {
    scopedEmpIds = new Set(
      employeeRoles.filter(r => r.departmentId === departmentId).map(r => r.employeeId)
    )
  }

  const scopedDeptId: number | null = isWideRole ? reqDeptId : (departmentId ?? null)

  // ── 取得當年案件（依委託日 commissionDate）─────────────────────────
  const yearStart = new Date(`${year}-01-01`)
  const yearEnd = new Date(`${year + 1}-01-01`)

  const cases = await prisma.case.findMany({
    where: { commissionDate: { gte: yearStart, lt: yearEnd } },
    select: {
      id: true,
      departmentId: true,
      commissionDate: true,
      status: true,
      actualFee: true,
      estimatedFee: true,
      assignments: { select: { employeeId: true, role: true, contributionRatio: true } },
    },
  })

  // ── 員工績效 ───────────────────────────────────────────────────────
  // [2026/07/14] - Lisa - 件數只計主辦；公證費（未決 estimatedFee／已決 actualFee）依承辦比例分攤
  const perfMap = new Map<number, {
    employeeId: number; name: string
    openCount: number; closedCount: number
    openFee: number; closedFee: number
  }>()

  for (const c of cases) {
    for (const a of c.assignments) {
      if (!scopedEmpIds.has(a.employeeId)) continue
      let row = perfMap.get(a.employeeId)
      if (!row) {
        row = {
          employeeId: a.employeeId,
          name: empMap.get(a.employeeId) ?? '—',
          openCount: 0, closedCount: 0, openFee: 0, closedFee: 0,
        }
        perfMap.set(a.employeeId, row)
      }
      const isPrimary = a.role === '主辦'
      const ratio = a.contributionRatio ?? 0
      if (c.status === '未決') {
        if (isPrimary) row.openCount += 1
        row.openFee += Math.round((c.estimatedFee ?? 0) * ratio)
      } else if (c.status === '已決') {
        if (isPrimary) row.closedCount += 1
        row.closedFee += Math.round((c.actualFee ?? 0) * ratio)
      }
    }
  }

  const employeePerformance = Array.from(perfMap.values()).sort((a, b) => a.employeeId - b.employeeId)

  // ── 接案件數：部門 × 12 月份交叉表（依委託日）──────────────────────
  const visibleDepts = scopedDeptId ? departments.filter(d => d.id === scopedDeptId) : departments
  const deptMonthly = visibleDepts.map(dept => {
    const months = new Array(12).fill(0) as number[]
    for (const c of cases) {
      if (c.departmentId !== dept.id) continue
      months[dayjs(c.commissionDate).month()] += 1
    }
    const total = months.reduce((s, v) => s + v, 0)
    return { name: dept.name, months, total }
  })

  // ── 建立 Excel ─────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook()

  function styleHeader(ws: ExcelJS.Worksheet, rowIdx: number, colCount: number) {
    const headerRow = ws.getRow(rowIdx)
    headerRow.height = 24
    headerRow.font = { bold: true, size: 11 }
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    for (let col = 1; col <= colCount; col++) {
      headerRow.getCell(col).fill = HEADER_FILL
      headerRow.getCell(col).border = THIN_BORDER
    }
  }

  // 工作表 1：員工績效（各員工案件統計）
  const ws1 = wb.addWorksheet('員工績效')
  ws1.columns = [
    { header: '人員', key: 'name', width: 16 },
    { header: '未決件數', key: 'openCount', width: 12 },
    { header: '已決件數', key: 'closedCount', width: 12 },
    { header: '未決公證費(預估)', key: 'openFee', width: 20 },
    { header: '已決公證費', key: 'closedFee', width: 18 },
  ]
  styleHeader(ws1, 1, 5)
  employeePerformance.forEach(p => {
    const row = ws1.addRow({
      name: p.name,
      openCount: p.openCount,
      closedCount: p.closedCount,
      openFee: p.openFee,
      closedFee: p.closedFee,
    })
    row.alignment = { vertical: 'middle', horizontal: 'center' }
    row.getCell('name').alignment = { vertical: 'middle', horizontal: 'left' }
    for (const c of ['openFee', 'closedFee']) {
      row.getCell(c).numFmt = '#,##0'
      row.getCell(c).alignment = { vertical: 'middle', horizontal: 'right' }
    }
    for (let col = 1; col <= 5; col++) row.getCell(col).border = THIN_BORDER
  })
  // 合計列
  const p1Sum = employeePerformance.reduce(
    (s, p) => ({
      openCount: s.openCount + p.openCount, closedCount: s.closedCount + p.closedCount,
      openFee: s.openFee + p.openFee, closedFee: s.closedFee + p.closedFee,
    }),
    { openCount: 0, closedCount: 0, openFee: 0, closedFee: 0 }
  )
  const sum1 = ws1.addRow({
    name: '合計', openCount: p1Sum.openCount, closedCount: p1Sum.closedCount,
    openFee: p1Sum.openFee, closedFee: p1Sum.closedFee,
  })
  sum1.font = { bold: true }
  sum1.alignment = { vertical: 'middle', horizontal: 'center' }
  sum1.getCell('name').alignment = { vertical: 'middle', horizontal: 'left' }
  for (const c of ['openFee', 'closedFee']) {
    sum1.getCell(c).numFmt = '#,##0'
    sum1.getCell(c).alignment = { vertical: 'middle', horizontal: 'right' }
  }
  for (let col = 1; col <= 5; col++) {
    sum1.getCell(col).fill = SUM_FILL
    sum1.getCell(col).border = THIN_BORDER
  }
  // [2026/07/14] - Lisa - 員工績效表下方加註
  const note1 = ws1.addRow(['註：未決件數、已決件數僅計主辦；未決、已決公證費依承辦比例分攤。'])
  ws1.mergeCells(note1.number, 1, note1.number, 5)
  note1.getCell(1).font = { size: 9, italic: true, color: { argb: 'FF888888' } }
  note1.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' }
  ws1.views = [{ state: 'frozen', ySplit: 1 }]

  // 工作表 2：接案件數（部門 × 12 月份）
  const ws2 = wb.addWorksheet(`${year}年接案件數`)
  const monthCols = Array.from({ length: 12 }, (_, i) => ({ header: `${i + 1}月`, key: `m${i}`, width: 7 }))
  ws2.columns = [
    { header: '部門', key: 'name', width: 18 },
    ...monthCols,
    { header: '年度合計', key: 'total', width: 12 },
  ]
  styleHeader(ws2, 1, 14)
  deptMonthly.forEach(d => {
    const rowData: Record<string, string | number> = { name: d.name, total: d.total }
    d.months.forEach((v, i) => { rowData[`m${i}`] = v })
    const row = ws2.addRow(rowData)
    row.alignment = { vertical: 'middle', horizontal: 'center' }
    row.getCell('name').alignment = { vertical: 'middle', horizontal: 'left' }
    for (let col = 1; col <= 14; col++) row.getCell(col).border = THIN_BORDER
  })
  // 合計列（各月合計 + 總計）
  const monthTotals = Array.from({ length: 12 }, (_, i) => deptMonthly.reduce((s, d) => s + d.months[i], 0))
  const grandTotal = monthTotals.reduce((s, v) => s + v, 0)
  const sum2Data: Record<string, string | number> = { name: '合計', total: grandTotal }
  monthTotals.forEach((v, i) => { sum2Data[`m${i}`] = v })
  const sum2 = ws2.addRow(sum2Data)
  sum2.font = { bold: true }
  sum2.alignment = { vertical: 'middle', horizontal: 'center' }
  sum2.getCell('name').alignment = { vertical: 'middle', horizontal: 'left' }
  for (let col = 1; col <= 14; col++) {
    sum2.getCell(col).fill = SUM_FILL
    sum2.getCell(col).border = THIN_BORDER
  }
  ws2.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]

  const buffer = await wb.xlsx.writeBuffer()
  const filename = `年度案件統計_${year}_${dayjs().format('YYYYMMDD')}.xlsx`

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="reports.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
