import { NextRequest, NextResponse } from 'next/server'
import { getSession, canViewAllDepts } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import ExcelJS from 'exceljs'
import dayjs from 'dayjs'

export const runtime = 'nodejs'

// 與 GET /api/cases 相同的資料範圍規則（FR-34/FR-04）
async function buildCaseScope(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) return {}
  if (canViewAllDepts(session.role) || !session.departmentId) return {}

  if (session.role === 'team_lead' && session.teamGroup) {
    const roles = await prisma.employeeRole.findMany({
      where: { departmentId: session.departmentId, teamGroup: session.teamGroup },
      select: { employeeId: true },
    })
    const employeeIds = Array.from(new Set(roles.map((r) => r.employeeId)))
    return {
      departmentId: session.departmentId,
      assignments: { some: { employeeId: { in: employeeIds } } },
    }
  }

  return { departmentId: session.departmentId }
}

// 西元日期 → 民國日期字串（例：112.08.29.）
function rocDate(d: Date | null | undefined): string {
  if (!d) return ''
  const day = dayjs(d)
  return `${day.year() - 1911}.${day.format('MM')}.${day.format('DD')}.`
}

// BigInt / number → Excel 數值（空值回傳 null 讓儲存格留白）
function num(v: bigint | number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  return Number(v)
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const status = searchParams.get('status') ?? '未決'
  const keyword = searchParams.get('q')
  const deptId = searchParams.get('deptId')
  const stage = searchParams.get('stage')
  const assigneeId = searchParams.get('assigneeId')
  const incidentDateFrom = searchParams.get('incidentDateFrom')
  const incidentDateTo = searchParams.get('incidentDateTo')
  const filterYear = searchParams.get('year')
  const filterQuarter = searchParams.get('quarter')
  const icId = searchParams.get('insuranceCompanyId')
  const contactsParam = searchParams.get('contacts')

  const scopeFilter = await buildCaseScope(session)

  const where: Record<string, unknown> = { ...scopeFilter }
  if (status && status !== 'all') where.status = status
  if (deptId) where.departmentId = parseInt(deptId)
  if (icId) where.insuranceCompanyId = parseInt(icId)
  if (contactsParam) {
    const list = contactsParam.split(',').map((s) => s.trim()).filter(Boolean)
    if (list.length) where.insuranceContact = { in: list }
  }
  if (stage) where.currentStage = stage
  if (session.role === 'handler') {
    where.assignments = { some: { employeeId: parseInt(session.sub) } }
    delete where.departmentId
  } else if (assigneeId) {
    where.assignments = { some: { employeeId: parseInt(assigneeId) } }
  }
  if (incidentDateFrom || incidentDateTo) {
    where.incidentDate = {
      ...(incidentDateFrom ? { gte: new Date(incidentDateFrom) } : {}),
      ...(incidentDateTo ? { lte: new Date(incidentDateTo) } : {}),
    }
  }
  // [2026/07/14] - Lisa - 年度改依委託日 commissionDate（與列表 API 一致，原為結案日 closeDate）
  if (filterYear) {
    const year = parseInt(filterYear)
    const qMonth: Record<string, [number, number]> = {
      Q1: [1, 3], Q2: [4, 6], Q3: [7, 9], Q4: [10, 12],
    }
    const [m1, m2] = filterQuarter ? qMonth[filterQuarter] ?? [1, 12] : [1, 12]
    where.commissionDate = {
      gte: new Date(`${year}-${String(m1).padStart(2, '0')}-01`),
      lte: new Date(`${year}-${String(m2).padStart(2, '0')}-${m2 === 3 || m2 === 6 || m2 === 9 ? 30 : m2 === 12 ? 31 : 30}`),
    }
  }

  if (keyword) {
    where.OR = [
      { caseNumber: { contains: keyword, mode: 'insensitive' } },
      { insuredName: { contains: keyword, mode: 'insensitive' } },
      { policyNumber: { contains: keyword, mode: 'insensitive' } },
      { insuranceCompany: { name: { contains: keyword, mode: 'insensitive' } } },
    ]
  }

  const cases = await prisma.case.findMany({
    where,
    include: {
      department: { select: { name: true } },
      insuranceCompany: { select: { name: true } },
      brokerCompany: { select: { name: true } },
      coInsurers: { include: { company: { select: { name: true } } } },
      assignments: { select: { role: true, employee: { select: { name: true } } } },
      // P 欄：案件紀錄全部事項（依紀錄日期舊→新），每筆一行「民國日期 內容」
      caseNotes: { select: { content: true, noteDate: true }, orderBy: { noteDate: 'asc' } },
    },
    orderBy: { commissionDate: 'desc' },
  })

  // ── 建立 Excel（彷照「工程113(24K)」sheet 欄位 A~V） ──
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('案件查詢')

  // 欄寬設定（A~V）
  const widths = [6, 16, 14, 14, 22, 22, 14, 12, 18, 22, 12, 24, 16, 12, 16, 40, 12, 10, 8, 8, 14, 10]
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })

  // 表頭（合併儲存格：G:H 公證編號、S:T 已決/未決、U:V 公證費）
  ws.mergeCells('G1:H1')
  ws.mergeCells('S1:T1')
  ws.mergeCells('U1:V1')
  const headers: Record<string, string> = {
    A: '項次', B: '保險公司', C: '保險公司承辦人', D: '委託聯繫/聯絡單',
    E: '保單號碼', F: '共保保單號碼/共保比例', G: '公證編號', I: '被保險人',
    J: '出險/查勘地點(效率整合)', K: '出險日期', L: '險種名稱/出險原因',
    M: '預估金額\n(未扣自負額)', N: '自負額', O: '預估賠償額\n(已扣自負額)',
    P: '目前工作處理進度', Q: '委託日期', R: '承辦人', S: '已決/未決',
    U: '公證費(已決/預估)',
  }
  for (const [col, text] of Object.entries(headers)) {
    ws.getCell(`${col}1`).value = text
  }
  const headerRow = ws.getRow(1)
  headerRow.height = 32
  headerRow.font = { bold: true, size: 11 }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  // 明確畫滿 A~V（22 欄）：合併表頭中留白的 H/T/V 欄也要上底色與框線
  for (let col = 1; col <= 22; col++) {
    const cell = headerRow.getCell(col)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
    cell.border = {
      top: { style: 'thin' }, left: { style: 'thin' },
      bottom: { style: 'thin' }, right: { style: 'thin' },
    }
  }

  // 資料列（自第 2 列起）
  cases.forEach((c, i) => {
    const primary = c.assignments.find((a) => a.role === '主辦') ?? c.assignments[0]
    const coText = c.coInsurers.length
      ? c.coInsurers
          .map((ci) => {
            const pct = ci.ratio <= 1 ? ci.ratio * 100 : ci.ratio
            return `${ci.policyNumber}（${pct}%）`
          })
          .join('；')
      : '無共保'
    const est = num(c.estimatedAmount)
    const ded = num(c.deductible)
    const claim = est !== null ? est - (ded ?? 0) : null

    const r = i + 2
    ws.getCell(`A${r}`).value = `${i + 1}.`
    ws.getCell(`B${r}`).value = c.insuranceCompany.name
    ws.getCell(`C${r}`).value = c.insuranceContact ?? ''
    ws.getCell(`D${r}`).value = c.contactFormStatus ?? ''
    ws.getCell(`E${r}`).value = c.policyNumber
    ws.getCell(`F${r}`).value = coText
    // 公證編號：以第一個「-」切分，前段（含「-」）放 G 欄，其餘放 H 欄；無「-」則全放 G 欄
    const dashIdx = c.caseNumber.indexOf('-')
    if (dashIdx >= 0) {
      ws.getCell(`G${r}`).value = c.caseNumber.slice(0, dashIdx + 1)
      ws.getCell(`H${r}`).value = c.caseNumber.slice(dashIdx + 1)
    } else {
      ws.getCell(`G${r}`).value = c.caseNumber
    }
    ws.getCell(`I${r}`).value = c.insuredName
    ws.getCell(`J${r}`).value = c.incidentLocation
    ws.getCell(`K${r}`).value = rocDate(c.incidentDate)
    ws.getCell(`L${r}`).value = `${c.insuranceType}-${c.incidentCause}`
    ws.getCell(`M${r}`).value = est
    ws.getCell(`N${r}`).value = ded
    ws.getCell(`O${r}`).value = claim
    ws.getCell(`P${r}`).value = c.caseNotes
      .map((n) => `${rocDate(n.noteDate)} ${n.content}`.trim())
      .join('\n')
    ws.getCell(`Q${r}`).value = rocDate(c.commissionDate)
    ws.getCell(`R${r}`).value = primary?.employee.name ?? ''
    const isClosed = c.status === '已決'
    // 已決/未決：已決放 S 欄，其餘（未決/銷案）放 T 欄
    ws.getCell(`${isClosed ? 'S' : 'T'}${r}`).value = c.status
    // 公證費：已決放「實際公證費」於 U 欄，未決放「預估公證費」於 V 欄
    if (isClosed) {
      ws.getCell(`U${r}`).value = c.actualFee ?? null
    } else {
      ws.getCell(`V${r}`).value = c.estimatedFee ?? null
    }

    const row = ws.getRow(r)
    row.alignment = { vertical: 'top', wrapText: true }
    // 明確畫滿 A~V（22 欄）框線：已決案件資料落在 S/U，若用 eachCell 會漏掉留白的 T/V 欄
    for (let col = 1; col <= 22; col++) {
      row.getCell(col).border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' },
      }
    }
    // 金額欄位千分位格式
    for (const col of ['M', 'N', 'O', 'U', 'V']) {
      ws.getCell(`${col}${r}`).numFmt = '#,##0'
    }
  })

  ws.views = [{ state: 'frozen', ySplit: 1 }]

  const buffer = await wb.xlsx.writeBuffer()
  const filename = `案件查詢_${dayjs().format('YYYYMMDD')}.xlsx`

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="cases.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  })
}
