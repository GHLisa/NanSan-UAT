import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding...')

  // Clear all tables (cascade handles FK order)
  await prisma.$executeRaw`
    TRUNCATE TABLE
      settlement_splits, settlements,
      case_logs, case_notes, case_progress, case_assignments,
      case_co_insurers, case_reviews, notifications, fee_targets,
      cases, dispatch_queue, employee_roles, company_fee_rates,
      company_fire_rates, employees, departments, regions,
      insurance_companies, broker_companies, insurance_types,
      incident_locations, case_number_seq
    RESTART IDENTITY CASCADE
  `

  const pw = await bcrypt.hash('nansan1234', 10)

  // ── Regions ──────────────────────────────────────────────────────────
  await prisma.region.createMany({
    data: [
      { name: '北區', code: 'NORTH' },
      { name: '中區', code: 'CENTRAL' },
      { name: '南區', code: 'SOUTH' },
    ],
  })

  // ── Departments ───────────────────────────────────────────────────────
  await prisma.department.createMany({
    data: [
      { name: '台北工程部', code: 'TPE-ENG', regionId: 1 },
      { name: '台北責任險部', code: 'TPE-LIA', regionId: 1 },
      { name: '台北火險部', code: 'TPE-FIRE', regionId: 1 },
      { name: '高雄工程部', code: 'KHH-ENG', regionId: 3 },
      { name: '高雄責任險部', code: 'KHH-LIA', regionId: 3 },
      { name: '台中工程部', code: 'TXG-ENG', regionId: 2 },
    ],
  })

  // ── Insurance Companies ───────────────────────────────────────────────
  await prisma.insuranceCompany.createMany({
    data: [
      { code: 'CK', name: '兆豐產物保險' },
      { code: 'NS', name: '南山產物保險' },
      { code: 'NA', name: '新安東京海上產物保險' },
      { code: 'FS', name: '第一產物保險' },
      { code: 'CT', name: '中國信託產物保險' },
      { code: 'HT', name: '和泰產物保險' },
      { code: 'MT', name: '明台產物保險' },
      { code: 'NL', name: '新光產物保險' },
      { code: 'SC', name: '華南產物保險' },
      { code: 'CC', name: '國泰產物保險' },
      { code: 'TN', name: '泰安產物保險' },
      { code: 'UI', name: '旺旺友聯產物保險' },
      { code: 'TF', name: '臺灣產物保險' },
      { code: 'FB', name: '富邦產物保險' },
    ],
  })

  // ── Broker Companies ──────────────────────────────────────────────────
  await prisma.brokerCompany.createMany({
    data: [
      { name: '台灣保代', isActive: true },
      { name: '宏泰保代', isActive: true },
      { name: '亞洲保代', isActive: true },
      { name: '新保成保代', isActive: true },
      { name: '國際保代', isActive: false },
    ],
  })

  // ── Insurance Types ───────────────────────────────────────────────────
  await prisma.insuranceType.createMany({
    data: [
      { name: '營造綜合險', feeCategory: '工程險', isActive: true },
      { name: '安裝工程險', feeCategory: '工程險', isActive: true },
      { name: '電子設備險', feeCategory: '工程險', isActive: true },
      { name: '機械險', feeCategory: '工程險', isActive: true },
      { name: '公共意外責任險', feeCategory: '責任險', isActive: true },
      { name: '產品責任險', feeCategory: '責任險', isActive: true },
      { name: '僱主責任險', feeCategory: '責任險', isActive: true },
      { name: '專業責任險', feeCategory: '責任險', isActive: true },
      { name: '火險', feeCategory: '火險', isActive: true },
    ],
  })

  // ── Incident Locations ────────────────────────────────────────────────
  await prisma.incidentLocation.createMany({
    data: [
      '台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市',
      '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣',
      '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
      '台東縣', '澎湖縣', '金門縣', '連江縣', '台中市烏日區',
      '高雄市前鎮區', '台北市內湖區', '新北市中和區', '桃園市中壢區',
    ].map((name) => ({ name, isActive: true })),
  })

  // ── Employees ─────────────────────────────────────────────────────────
  const empData = [
    { name: '王小明', username: 'handler01', email: 'handler01@nansan.com.tw' },
    { name: '陳美華', username: 'handler02', email: 'handler02@nansan.com.tw' },
    { name: '林建宏', username: 'teamlead01', email: 'teamlead01@nansan.com.tw' },
    { name: '張志偉', username: 'manager01', email: 'manager01@nansan.com.tw' },
    { name: '李大偉', username: 'vp01', email: 'vp01@nansan.com.tw' },
    { name: '吳淑芬', username: 'admin01', email: 'admin01@nansan.com.tw' },
    { name: '劉明達', username: 'multi01', email: 'multi01@nansan.com.tw' },
    { name: '系統管理員', username: 'sysadmin', email: 'sysadmin@nansan.com.tw' },
    { name: '邱秀蘭', username: 'handler05', email: 'handler05@nansan.com.tw' },
    { name: '周偉民', username: 'manager03', email: 'manager03@nansan.com.tw' },
    { name: '黃建志', username: 'manager05', email: 'manager05@nansan.com.tw' },
    { name: '陳俊豪', username: 'handler03', email: 'handler03@nansan.com.tw' },
    { name: '蔡雅婷', username: 'handler04', email: 'handler04@nansan.com.tw' },
    { name: '許文雄', username: 'teamlead02', email: 'teamlead02@nansan.com.tw' },
    { name: '方淑芳', username: 'manager02', email: 'manager02@nansan.com.tw' },
    { name: '徐志遠', username: 'handler06', email: 'handler06@nansan.com.tw' },
  ]
  await prisma.employee.createMany({
    data: empData.map((e) => ({ ...e, password: pw, isActive: true })),
  })

  // ── Employee Roles ────────────────────────────────────────────────────
  // emp ids: handler01=1, handler02=2, teamlead01=3, manager01=4, vp01=5,
  //          admin01=6, multi01=7, sysadmin=8, handler05=9, manager03=10,
  //          manager05=11, handler03=12, handler04=13, teamlead02=14,
  //          manager02=15, handler06=16
  await prisma.employeeRole.createMany({
    data: [
      { employeeId: 1,  departmentId: 1, role: 'handler',      roleName: '承辦人',   teamGroup: '一組', isPrimary: true },
      { employeeId: 2,  departmentId: 2, role: 'handler',      roleName: '承辦人',   teamGroup: '二組', isPrimary: true },
      { employeeId: 3,  departmentId: 1, role: 'team_lead',    roleName: '組長',     teamGroup: '一組', isPrimary: true },
      { employeeId: 4,  departmentId: 1, role: 'dept_manager', roleName: '部門主管', teamGroup: null,   isPrimary: true },
      { employeeId: 5,  departmentId: null, role: 'vp',        roleName: '執行副總', teamGroup: null,   isPrimary: true },
      { employeeId: 6,  departmentId: 1, role: 'admin_staff',  roleName: '行政人員', teamGroup: null,   isPrimary: true },
      { employeeId: 7,  departmentId: 1, role: 'handler',      roleName: '承辦人',   teamGroup: '一組', isPrimary: true },
      { employeeId: 7,  departmentId: 4, role: 'handler',      roleName: '承辦人',   teamGroup: null,   isPrimary: false },
      { employeeId: 8,  departmentId: null, role: 'sysadmin',  roleName: '系統管理員', teamGroup: null, isPrimary: true },
      { employeeId: 9,  departmentId: 3, role: 'handler',      roleName: '承辦人',   teamGroup: null,   isPrimary: true },
      { employeeId: 10, departmentId: 3, role: 'dept_manager', roleName: '部門主管', teamGroup: null,   isPrimary: true },
      { employeeId: 11, departmentId: 4, role: 'dept_manager', roleName: '部門主管', teamGroup: null,   isPrimary: true },
      { employeeId: 12, departmentId: 1, role: 'handler',      roleName: '承辦人',   teamGroup: '一組', isPrimary: true },
      { employeeId: 13, departmentId: 1, role: 'handler',      roleName: '承辦人',   teamGroup: '二組', isPrimary: true },
      { employeeId: 14, departmentId: 2, role: 'team_lead',    roleName: '組長',     teamGroup: null,   isPrimary: true },
      { employeeId: 15, departmentId: 2, role: 'dept_manager', roleName: '部門主管', teamGroup: null,   isPrimary: true },
      { employeeId: 16, departmentId: 4, role: 'handler',      roleName: '承辦人',   teamGroup: null,   isPrimary: true },
    ],
  })

  // ── Company Fee Rates ─────────────────────────────────────────────────
  const bands1 = JSON.stringify([
    { maxAmount: 5_000_000, rate: 0.042 },
    { maxAmount: 10_000_000, rate: 0.032 },
    { maxAmount: 20_000_000, rate: 0.016 },
    { maxAmount: 100_000_000, rate: 0.011 },
    { maxAmount: null, rate: 0.008 },
  ])
  await prisma.companyFeeRate.createMany({
    data: [
      { companyCode: 'CK', companyName: '兆豐產物保險', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000, rateBands: bands1, mealExpense: 600, accommodationExpense: 1200, photoFee: 500, effectiveDate: new Date('2019-11-01') },
      { companyCode: 'NS', companyName: '南山產物保險', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000, rateBands: bands1, mealExpense: 600, accommodationExpense: 1200, photoFee: 500, effectiveDate: new Date('2020-01-01') },
      { companyCode: 'FB', companyName: '富邦產物保險', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000, rateBands: bands1, mealExpense: 600, accommodationExpense: 1200, photoFee: 500, effectiveDate: new Date('2020-06-01') },
    ],
  })

  // ── Company Fire Rates ────────────────────────────────────────────────
  const fireBands = JSON.stringify([
    { maxAmount: 50_000_000, rate: 0.03 },
    { maxAmount: 200_000_000, rate: 0.02 },
    { maxAmount: 500_000_000, rate: 0.01 },
    { maxAmount: null, rate: 0.008 },
  ])
  await prisma.companyFireRate.createMany({
    data: [
      { companyCode: 'TF', companyName: '臺灣產物保險', debitNoteType: '稅內含', minFee: 20000, rateBands: fireBands, effectiveDate: new Date('2026-05-15') },
      { companyCode: 'CK', companyName: '兆豐產物保險', debitNoteType: '全額外加', minFee: 20000, rateBands: fireBands, effectiveDate: new Date('2026-05-15') },
    ],
  })

  // ── Sample Cases ──────────────────────────────────────────────────────
  const stages = ['進件/建檔', '初步報告', '理算表', '發函', '中間報告', '理算說明/協商', '正式結案報告', '請款單填寫', '結案']
  const caseSeed = [
    { caseNumber: 'TPE-ENG-2026-001', departmentId: 1, insuranceCompanyId: 1, policyNumber: 'CK-2025-00123', insuredName: '台灣建設股份有限公司', incidentLocation: '新北市中和區', incidentDate: new Date('2026-01-15'), commissionDate: new Date('2026-01-20'), insuranceType: '營造綜合險', incidentCause: '颱風損害', estimatedAmount: 3_500_000, status: '未決', currentStage: stages[2] },
    { caseNumber: 'TPE-ENG-2026-002', departmentId: 1, insuranceCompanyId: 2, policyNumber: 'NS-2025-00456', insuredName: '大安工程有限公司', incidentLocation: '台北市', incidentDate: new Date('2026-02-10'), commissionDate: new Date('2026-02-12'), insuranceType: '安裝工程險', incidentCause: '施工意外', estimatedAmount: 8_200_000, status: '未決', currentStage: stages[4] },
    { caseNumber: 'TPE-ENG-2026-003', departmentId: 1, insuranceCompanyId: 3, policyNumber: 'NA-2026-00789', insuredName: '新鑫機械工業股份有限公司', incidentLocation: '桃園市中壢區', incidentDate: new Date('2026-03-05'), commissionDate: new Date('2026-03-08'), insuranceType: '機械險', incidentCause: '機械故障', estimatedAmount: 1_200_000, status: '未決', currentStage: stages[0] },
    { caseNumber: 'TPE-LIA-2026-001', departmentId: 2, insuranceCompanyId: 5, policyNumber: 'CT-2026-00321', insuredName: '綠地餐飲集團', incidentLocation: '台北市內湖區', incidentDate: new Date('2026-01-28'), commissionDate: new Date('2026-02-01'), insuranceType: '公共意外責任險', incidentCause: '顧客意外傷害', estimatedAmount: 500_000, status: '未決', currentStage: stages[1] },
    { caseNumber: 'TPE-LIA-2026-002', departmentId: 2, insuranceCompanyId: 7, policyNumber: 'MT-2025-00654', insuredName: '安心科技股份有限公司', incidentLocation: '新北市', incidentDate: new Date('2026-03-15'), commissionDate: new Date('2026-03-17'), insuranceType: '產品責任險', incidentCause: '產品瑕疵', estimatedAmount: 2_800_000, status: '未決', currentStage: stages[3] },
    { caseNumber: 'TPE-FIRE-2026-001', departmentId: 3, insuranceCompanyId: 13, policyNumber: 'TF-2026-00111', insuredName: '老字號食品行', incidentLocation: '台北市', incidentDate: new Date('2026-02-20'), commissionDate: new Date('2026-02-22'), insuranceType: '火險', incidentCause: '電線走火', estimatedAmount: 4_500_000, finalAmount: 4_200_000, actualFee: 120000, status: '已決', currentStage: stages[8], closeDate: new Date('2026-04-10') },
    { caseNumber: 'KHH-ENG-2026-001', departmentId: 4, insuranceCompanyId: 1, policyNumber: 'CK-2026-00876', insuredName: '南台灣建設開發公司', incidentLocation: '高雄市前鎮區', incidentDate: new Date('2026-01-05'), commissionDate: new Date('2026-01-08'), insuranceType: '營造綜合險', incidentCause: '地震損害', estimatedAmount: 12_000_000, status: '未決', currentStage: stages[5] },
    { caseNumber: 'TPE-ENG-2025-050', departmentId: 1, insuranceCompanyId: 14, policyNumber: 'FB-2024-01234', insuredName: '永豐建設股份有限公司', incidentLocation: '台中市', incidentDate: new Date('2025-10-20'), commissionDate: new Date('2025-10-25'), insuranceType: '安裝工程險', incidentCause: '施工意外', estimatedAmount: 6_000_000, finalAmount: 5_800_000, actualFee: 180000, status: '已決', currentStage: stages[8], closeDate: new Date('2026-02-28') },
    { caseNumber: 'TPE-ENG-2025-049', departmentId: 1, insuranceCompanyId: 6, policyNumber: 'HT-2024-09876', insuredName: '精密儀器製造有限公司', incidentLocation: '新竹市', incidentDate: new Date('2025-09-15'), commissionDate: new Date('2025-09-18'), insuranceType: '電子設備險', incidentCause: '設備損壞', estimatedAmount: 900_000, status: '銷案', currentStage: stages[1], notes: '保戶不願配合' },
    { caseNumber: 'TPE-LIA-2026-003', departmentId: 2, insuranceCompanyId: 9, policyNumber: 'SC-2026-00445', insuredName: '健康照護機構', incidentLocation: '台北市', incidentDate: new Date('2026-04-01'), commissionDate: new Date('2026-04-03'), insuranceType: '僱主責任險', incidentCause: '員工職災', estimatedAmount: 1_500_000, status: '未決', currentStage: stages[0] },
  ]

  for (const c of caseSeed) {
    await prisma.case.create({ data: c })
  }

  // ── Case Assignments ──────────────────────────────────────────────────
  await prisma.caseAssignment.createMany({
    data: [
      { caseId: 1, employeeId: 1, role: '主辦', contributionRatio: 0.7 },
      { caseId: 1, employeeId: 12, role: '協辦', contributionRatio: 0.3 },
      { caseId: 2, employeeId: 3, role: '主辦', contributionRatio: 1.0 },
      { caseId: 3, employeeId: 13, role: '主辦', contributionRatio: 1.0 },
      { caseId: 4, employeeId: 2, role: '主辦', contributionRatio: 1.0 },
      { caseId: 5, employeeId: 2, role: '主辦', contributionRatio: 0.6 },
      { caseId: 5, employeeId: 14, role: '協辦', contributionRatio: 0.4 },
      { caseId: 6, employeeId: 9, role: '主辦', contributionRatio: 1.0 },
      { caseId: 7, employeeId: 7, role: '主辦', contributionRatio: 1.0 },
      { caseId: 8, employeeId: 1, role: '主辦', contributionRatio: 1.0 },
      { caseId: 9, employeeId: 12, role: '主辦', contributionRatio: 1.0 },
      { caseId: 10, employeeId: 2, role: '主辦', contributionRatio: 1.0 },
    ],
  })

  // ── Settlement for closed cases ───────────────────────────────────────
  const settlement6 = await prisma.settlement.create({
    data: { caseId: 6, reportDate: new Date('2026-04-08'), baseFee: 115000, travelExpense: 5000, totalFee: 120000 },
  })
  await prisma.settlementSplit.create({
    data: { settlementId: settlement6.id, employeeId: 9, ratio: 1.0, amount: 120000 },
  })

  const settlement8 = await prisma.settlement.create({
    data: { caseId: 8, reportDate: new Date('2026-02-26'), baseFee: 170000, travelExpense: 10000, totalFee: 180000 },
  })
  await prisma.settlementSplit.create({
    data: { settlementId: settlement8.id, employeeId: 1, ratio: 1.0, amount: 180000 },
  })

  // ── Case Number Sequences ─────────────────────────────────────────────
  await prisma.caseNumberSeq.createMany({
    data: [
      { deptCode: 'TPE-ENG', nextSeq: 4 },
      { deptCode: 'TPE-LIA', nextSeq: 4 },
      { deptCode: 'TPE-FIRE', nextSeq: 2 },
      { deptCode: 'KHH-ENG', nextSeq: 2 },
      { deptCode: 'KHH-LIA', nextSeq: 1 },
      { deptCode: 'TXG-ENG', nextSeq: 1 },
    ],
  })

  // ── Sample Notifications ──────────────────────────────────────────────
  await prisma.notification.createMany({
    data: [
      { type: 'review_submitted', title: '文件送審通知', message: '案件 TPE-ENG-2026-002 已送交複核', caseId: 2, targetRoles: 'dept_manager', isRead: false },
      { type: 'review_approved', title: '文件複核完成', message: '案件 TPE-LIA-2026-001 文件已核准', caseId: 4, targetRoles: 'handler', isRead: true },
      { type: 'case_assigned', title: '新案件指派', message: '新案件 KHH-ENG-2026-001 已指派至高雄工程部', caseId: 7, targetRoles: 'handler', isRead: false },
    ],
  })

  console.log('✅ Seed completed!')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
