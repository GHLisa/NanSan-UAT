import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const MAX = Number.MAX_SAFE_INTEGER

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
      incident_locations, incident_causes, case_number_seq
    RESTART IDENTITY CASCADE
  `

  const pw = await bcrypt.hash('nansan1234', 10)

  // ── Regions ──────────────────────────────────────────────────────────
  // id: 台北=1, 台中=2, 高雄=3
  await prisma.region.createMany({
    data: [
      { name: '台北', code: 'TP' },
      { name: '台中', code: 'TC' },
      { name: '高雄', code: 'KH' },
    ], // 公證編號代號(caseNoCode) 不於種子設定，改由基礎資料「區域」維護
  })

  // ── Departments (FR-91) ───────────────────────────────────────────────
  // 8 個部門，code 對齊 demo / FSD §7
  // id: 台北工程部=1, 台北責任險部=2, 台中工程部=3, 台中責任險部=4,
  //     高雄工程部=5, 高雄責任險部=6, 台北火險部=7(NF), 高雄火險部=8(KF)
  await prisma.department.createMany({
    data: [
      { name: '台北工程部',   code: 'NL', regionId: 1 },
      { name: '台北責任險部', code: 'NB', regionId: 1 },
      { name: '台中工程部',   code: 'CL', regionId: 2 },
      { name: '台中責任險部', code: 'CB', regionId: 2 },
      { name: '高雄工程部',   code: 'KL', regionId: 3 },
      { name: '高雄責任險部', code: 'KB', regionId: 3 },
      { name: '台北火險部',   code: 'NF', regionId: 1 },
      { name: '高雄火險部',   code: 'KF', regionId: 3 },
    ], // 公證編號代號(caseNoCode) 不於種子設定，改由基礎資料「部門」維護
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
      { code: 'CC', name: '國泰世紀產物保險' },
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
      { name: '水險', feeCategory: '水險', isActive: true },
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

  // ── Incident Causes（出險原因，對齊原前端寫死清單）─────────────────────
  await prisma.incidentCause.createMany({
    data: [
      '本體損壞', '火災', '水災', '第三人損害', '施工意外',
      '機械故障', '電氣損壞', '竊盜', '其他',
    ].map((name) => ({ name, isActive: true })),
  })

  // ── Employees (FR-91，對齊 FSD §7 / demo users.js) ─────────────────────
  // emp id 順序固定（RESTART IDENTITY 後從 1 起）
  const empData = [
    { name: '王小明', username: 'handler01', email: 'handler01@nansan.com.tw' },     // 1
    { name: '陳志遠', username: 'handler02', email: 'handler02@nansan.com.tw' },     // 2
    { name: '李大華', username: 'handler03', email: 'handler03@nansan.com.tw' },     // 3
    { name: '吳芳宜', username: 'handler04', email: 'handler04@nansan.com.tw' },     // 4
    { name: '林組長', username: 'teamlead01', email: 'teamlead01@nansan.com.tw' },   // 5
    { name: '黃副組長', username: 'teamlead02', email: 'teamlead02@nansan.com.tw' }, // 6
    { name: '張主管', username: 'manager01', email: 'manager01@nansan.com.tw' },     // 7
    { name: '蔡部長', username: 'manager02', email: 'manager02@nansan.com.tw' },     // 8
    { name: '吳哲旭', username: 'vp01', email: 'vp01@nansan.com.tw' },               // 9
    { name: '周行政', username: 'admin01', email: 'admin01@nansan.com.tw' },         // 10
    { name: '多角色測試', username: 'multi01', email: 'multi01@nansan.com.tw' },     // 11
    { name: '系統管理員', username: 'sysadmin', email: 'sysadmin@nansan.com.tw' },   // 12
    { name: '鄭雅玲', username: 'handler05', email: 'handler05@nansan.com.tw' },     // 13 台北火險部承辦
    { name: '方曉琳', username: 'teamlead03', email: 'teamlead03@nansan.com.tw' },   // 14 台北火險部組長
    { name: '林光輝', username: 'manager03', email: 'manager03@nansan.com.tw' },     // 15 台北火險部主管
    { name: '黃建宏', username: 'handler06', email: 'handler06@nansan.com.tw' },     // 16 高雄火險部承辦
    { name: '許志豪', username: 'manager04', email: 'manager04@nansan.com.tw' },     // 17 高雄火險部主管
    { name: '李建明', username: 'manager05', email: 'manager05@nansan.com.tw' },     // 18 高雄工程部主管
  ]
  await prisma.employee.createMany({
    data: empData.map((e) => ({ ...e, password: pw, isActive: true })),
  })

  // ── Employee Roles ────────────────────────────────────────────────────
  // departmentId 對照：台北工程部=1, 台北責任險部=2, 高雄工程部=5,
  //                    台北火險部=7, 高雄火險部=8
  await prisma.employeeRole.createMany({
    data: [
      { employeeId: 1,  departmentId: 1,    role: 'handler',      roleName: '承辦人',   teamGroup: '一組', isPrimary: true },
      { employeeId: 2,  departmentId: 2,    role: 'handler',      roleName: '承辦人',   teamGroup: '二組', isPrimary: true },
      { employeeId: 3,  departmentId: 1,    role: 'handler',      roleName: '承辦人',   teamGroup: '一組', isPrimary: true },
      { employeeId: 4,  departmentId: 5,    role: 'handler',      roleName: '承辦人',   teamGroup: '二組', isPrimary: true },
      { employeeId: 5,  departmentId: 1,    role: 'team_lead',    roleName: '組長',     teamGroup: '一組', isPrimary: true },
      { employeeId: 6,  departmentId: 2,    role: 'team_lead',    roleName: '組長',     teamGroup: '二組', isPrimary: true },
      { employeeId: 7,  departmentId: 1,    role: 'dept_manager', roleName: '部門主管', teamGroup: null,   isPrimary: true },
      { employeeId: 8,  departmentId: 2,    role: 'dept_manager', roleName: '部門主管', teamGroup: null,   isPrimary: true },
      { employeeId: 9,  departmentId: null, role: 'vp',           roleName: '執行副總', teamGroup: null,   isPrimary: true },
      { employeeId: 10, departmentId: 1,    role: 'admin_staff',  roleName: '行政人員', teamGroup: null,   isPrimary: true },
      // multi01：台北工程部承辦（主） + 高雄工程部承辦（附）
      { employeeId: 11, departmentId: 1,    role: 'handler',      roleName: '承辦人',   teamGroup: '一組', isPrimary: true },
      { employeeId: 11, departmentId: 5,    role: 'handler',      roleName: '承辦人',   teamGroup: '二組', isPrimary: false },
      { employeeId: 12, departmentId: null, role: 'sysadmin',     roleName: '系統管理員', teamGroup: null, isPrimary: true },
      // 台北火險部
      { employeeId: 13, departmentId: 7,    role: 'handler',      roleName: '承辦人',   teamGroup: '一組', isPrimary: true },
      { employeeId: 14, departmentId: 7,    role: 'team_lead',    roleName: '組長',     teamGroup: '一組', isPrimary: true },
      { employeeId: 15, departmentId: 7,    role: 'dept_manager', roleName: '部門主管', teamGroup: null,   isPrimary: true },
      // 高雄火險部
      { employeeId: 16, departmentId: 8,    role: 'handler',      roleName: '承辦人',   teamGroup: '一組', isPrimary: true },
      { employeeId: 17, departmentId: 8,    role: 'dept_manager', roleName: '部門主管', teamGroup: null,   isPrimary: true },
      // 高雄工程部主管（FR-90 加簽審核來源）
      { employeeId: 18, departmentId: 5,    role: 'dept_manager', roleName: '部門主管', teamGroup: null,   isPrimary: true },
    ],
  })

  // ── Company Fee Rates（工程險／責任險，14 家，全量移植 demo companyFeeRates.js）─
  const engBands = (arr: { maxAmount: number | null; rate: number | null }[]) => JSON.stringify(arr)
  // 一般 4 段費率
  const stdEng = engBands([
    { maxAmount: 5_000_000,   rate: 0.042 },
    { maxAmount: 10_000_000,  rate: 0.032 },
    { maxAmount: 20_000_000,  rate: 0.016 },
    { maxAmount: 100_000_000, rate: 0.011 },
  ])

  await prisma.companyFeeRate.createMany({
    data: [
      { companyCode: 'CK', companyName: '兆豐', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000, rateBands: stdEng, mealExpense: '400', accommodationExpense: '1000', photoFee: '15', effectiveDate: new Date('2019-11-01') },
      { companyCode: 'NS', companyName: '南山', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000, rateBands: stdEng, mealExpense: '0', accommodationExpense: '0', photoFee: '0', effectiveDate: new Date('2020-01-01') },
      { companyCode: 'NA', companyName: '新安東京', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000, rateBands: stdEng, mealExpense: '0', accommodationExpense: '1000', photoFee: '15', effectiveDate: new Date('2020-01-01') },
      { companyCode: 'FS', companyName: '第一', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000, rateBands: stdEng, mealExpense: '400', accommodationExpense: '1000', photoFee: '15', effectiveDate: new Date('2019-10-01') },
      { companyCode: 'CT', companyName: '中國信託', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000, rateBands: stdEng, mealExpense: '400', accommodationExpense: '1000', photoFee: '15', effectiveDate: new Date('2020-01-01') },
      { companyCode: 'HT', companyName: '和泰', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000, rateBands: stdEng, mealExpense: '400', accommodationExpense: '1000', photoFee: '15', effectiveDate: new Date('2020-01-01') },
      {
        companyCode: 'MT', companyName: '明台', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000, rateBands: stdEng,
        subRate: JSON.stringify({
          insuranceType: ['工程附加雇主責任'],
          rateBands: [
            { maxAmount: 5_000_000,   rate: 0.030 },
            { maxAmount: 10_000_000,  rate: 0.020 },
            { maxAmount: 20_000_000,  rate: 0.010 },
            { maxAmount: 100_000_000, rate: null },
          ],
        }),
        mealExpense: '300', accommodationExpense: '1000', photoFee: '10', effectiveDate: new Date('2020-01-01'),
      },
      { companyCode: 'NL', companyName: '新光', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000, rateBands: stdEng, mealExpense: '0', accommodationExpense: '2000', photoFee: '0', effectiveDate: new Date('2020-01-01') },
      { companyCode: 'SC', companyName: '華南', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000, rateBands: stdEng, mealExpense: '400', accommodationExpense: '1000', photoFee: '15', effectiveDate: new Date('2019-10-01') },
      {
        companyCode: 'CC', companyName: '國泰世紀', insuranceType: '工程險', debitNoteType: '全額外加', minFee: 20000, rateBands: stdEng,
        subRate: JSON.stringify({
          insuranceType: ['責任險'],
          rateBands: [
            { maxAmount: 5_000_000,   rate: 0.042 },
            { maxAmount: 10_000_000,  rate: 0.032 },
            { maxAmount: 20_000_000,  rate: 0.016 },
            { maxAmount: 100_000_000, rate: 0.011 },
          ],
        }),
        mealExpense: '0', accommodationExpense: '1000', photoFee: '0', effectiveDate: new Date('2020-01-01'),
      },
      { companyCode: 'TN', companyName: '泰安', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000, rateBands: stdEng, mealExpense: '400', accommodationExpense: '1000', photoFee: '15', effectiveDate: new Date('2019-10-01') },
      {
        companyCode: 'UI', companyName: '旺旺友聯', insuranceType: '工程險,責任險', debitNoteType: '公證費外加', minFee: 20000,
        rateBands: engBands([
          { maxAmount: 5_000_000,   rate: 0.042 },
          { maxAmount: 10_000_000,  rate: 0.032 },
          { maxAmount: 20_000_000,  rate: 0.016 },
          { maxAmount: 100_000_000, rate: null },
        ]),
        mealExpense: '400', accommodationExpense: '1000', photoFee: '0', effectiveDate: new Date('2019-09-01'),
      },
      { companyCode: 'TF', companyName: '臺灣', insuranceType: '工程險,責任險', debitNoteType: '稅內含', minFee: 20000, rateBands: stdEng, mealExpense: '400', accommodationExpense: '1000', photoFee: '15', effectiveDate: new Date('2019-11-01') },
      {
        companyCode: 'FB', companyName: '富邦', insuranceType: '工程險,責任險', debitNoteType: '全額外加', minFee: 20000,
        rateBands: engBands([
          { maxAmount: 5_000_000,    rate: 0.042 },
          { maxAmount: 10_000_000,   rate: 0.032 },
          { maxAmount: 20_000_000,   rate: 0.016 },
          { maxAmount: 100_000_000,  rate: 0.011 },
          { maxAmount: 500_000_000,  rate: 0.010 },
          { maxAmount: 1_000_000_000, rate: 0.009 },
          { maxAmount: 2_000_000_000, rate: 0.008 },
        ]),
        // FB 餐費/住宿/相片費為複合結構（JSON 編碼）：餐費分時段、住宿分地點、相片費文字說明
        mealExpense: JSON.stringify({ morning: 80, noon: 120, evening: 150 }),
        accommodationExpense: JSON.stringify({ taipei: 3300, other: 2700 }),
        photoFee: JSON.stringify('10張/A4'),
        effectiveDate: new Date('2019-10-01'),
      },
    ],
  })

  // ── Company Fire Rates（火險，14 家，全量移植 demo companyFireRates.js）─────
  const fireBands = (arr: { maxAmount: number | null; rate: number | null }[]) => JSON.stringify(arr)
  // 一般 4 段火險費率
  const stdFire = fireBands([
    { maxAmount: 5_000_000,   rate: 0.030 },
    { maxAmount: 20_000_000,  rate: 0.020 },
    { maxAmount: 100_000_000, rate: 0.010 },
    { maxAmount: 500_000_000, rate: 0.008 },
  ])
  const fireEff = new Date('2026-05-15')

  await prisma.companyFireRate.createMany({
    data: [
      { companyCode: 'TF', companyName: '臺灣', debitNoteType: '稅內含',       minFee: 20000, rateBands: stdFire, effectiveDate: fireEff },
      { companyCode: 'CK', companyName: '兆豐', debitNoteType: '全額外加',     minFee: 20000, rateBands: stdFire, effectiveDate: fireEff },
      { companyCode: 'HT', companyName: '和泰', debitNoteType: '全額外加',     minFee: 20000, rateBands: stdFire, effectiveDate: fireEff },
      // 中國信託：demo 火險用代號 KH，本系統保險公司代號為 CT，對齊為 CT
      { companyCode: 'CT', companyName: '中國信託', debitNoteType: '全額外加', minFee: 20000, rateBands: stdFire, effectiveDate: fireEff },
      { companyCode: 'TN', companyName: '泰安', debitNoteType: '公證費外加稅', minFee: 20000, rateBands: stdFire, effectiveDate: fireEff },
      { companyCode: 'MT', companyName: '明台', debitNoteType: '全額外加',     minFee: 20000, rateBands: stdFire, effectiveDate: fireEff },
      { companyCode: 'NL', companyName: '新光', debitNoteType: '公證費稅外加', minFee: 20000, rateBands: stdFire, effectiveDate: fireEff },
      {
        companyCode: 'NS', companyName: '南山', debitNoteType: '全額外加', minFee: 20000, rateBands: stdFire, effectiveDate: fireEff,
        remarks: '住宅火險及其附加險、其他個人財產保險，理算金額合計 ≤ NT$300,000 者，公證費一律 NT$12,000。\n多地(廠)址同一事故出險：其中 2 地仍依 NT$2 萬，其餘依 NT$5 千計算。\n水險商業動產事故 → 適用火險費率；受託物管理人責任保險事故 → 適用新種險費率。\n交通費用、差旅費用及影像輸出費用：經保險公司同意，以實報實支原則核定支付。',
      },
      { companyCode: 'UI', companyName: '旺旺友聯', debitNoteType: '公證費外加稅', minFee: 20000, rateBands: stdFire, effectiveDate: fireEff },
      { companyCode: 'FS', companyName: '第一', debitNoteType: '全額外加', minFee: 20000, rateBands: stdFire, effectiveDate: fireEff },
      { companyCode: 'SC', companyName: '華南', debitNoteType: '全額外加', minFee: 20000, rateBands: stdFire, effectiveDate: fireEff },
      { companyCode: 'CC', companyName: '國泰世紀', debitNoteType: '全額外加', minFee: 20000, rateBands: stdFire, effectiveDate: fireEff },
      { companyCode: 'NA', companyName: '新安東京海上', debitNoteType: '全額外加', minFee: 20000, rateBands: stdFire, effectiveDate: fireEff },
      {
        companyCode: 'FB', companyName: '富邦', debitNoteType: '全額外加', minFee: 20000, effectiveDate: fireEff,
        // 富邦採 8 段
        rateBands: fireBands([
          { maxAmount: 5_000_000,    rate: 0.030 },
          { maxAmount: 10_000_000,   rate: 0.025 },
          { maxAmount: 20_000_000,   rate: 0.020 },
          { maxAmount: 100_000_000,  rate: 0.010 },
          { maxAmount: 500_000_000,  rate: 0.009 },
          { maxAmount: 1_000_000_000, rate: 0.008 },
          { maxAmount: 2_000_000_000, rate: 0.007 },
          { maxAmount: MAX,          rate: 0.006 },
        ]),
        remarks: '最低公證費 NT$2 萬；多地(廠)址同一事故，公證費低於 NT$2 萬者，其中 2 地依 NT$2 萬，其餘依 NT$5 千計算。\n水險商業動產事故 → 適用火險費率；受託物管理人責任保險事故 → 適用新種險費率。',
      },
    ],
  })

  // ── Sample Cases ──────────────────────────────────────────────────────
  // departmentId 對照：台北工程部=1(NL), 台北責任險部=2(NB),
  //                    高雄工程部=5(KL), 台北火險部=7(NF)
  const stages = ['進件/建檔', '初步報告', '理算表', '發函', '中間報告', '理算說明/協商', '正式結案報告', '請款單填寫', '結案']
  const caseSeed = [
    { caseNumber: 'NL-2026-001', departmentId: 1, insuranceCompanyId: 1, policyNumber: 'CK-2025-00123', insuredName: '台灣建設股份有限公司', incidentLocation: '新北市中和區', incidentDate: new Date('2026-01-15'), commissionDate: new Date('2026-01-20'), insuranceType: '營造綜合險', incidentCause: '颱風損害', estimatedAmount: 3_500_000, estimatedFee: 147000, status: '未決', currentStage: stages[2], isSpecialCase: true },
    { caseNumber: 'NL-2026-002', departmentId: 1, insuranceCompanyId: 2, policyNumber: 'NS-2025-00456', insuredName: '大安工程有限公司', incidentLocation: '台北市', incidentDate: new Date('2026-02-10'), commissionDate: new Date('2026-02-12'), insuranceType: '安裝工程險', incidentCause: '施工意外', estimatedAmount: 8_200_000, status: '未決', currentStage: stages[4] },
    { caseNumber: 'NL-2026-003', departmentId: 1, insuranceCompanyId: 3, policyNumber: 'NA-2026-00789', insuredName: '新鑫機械工業股份有限公司', incidentLocation: '桃園市中壢區', incidentDate: new Date('2026-03-05'), commissionDate: new Date('2026-03-08'), insuranceType: '機械險', incidentCause: '機械故障', estimatedAmount: 1_200_000, status: '未決', currentStage: stages[0] },
    { caseNumber: 'NB-2026-001', departmentId: 2, insuranceCompanyId: 5, policyNumber: 'CT-2026-00321', insuredName: '綠地餐飲集團', incidentLocation: '台北市內湖區', incidentDate: new Date('2026-01-28'), commissionDate: new Date('2026-02-01'), insuranceType: '公共意外責任險', incidentCause: '顧客意外傷害', estimatedAmount: 500_000, status: '未決', currentStage: stages[1] },
    { caseNumber: 'NB-2026-002', departmentId: 2, insuranceCompanyId: 7, policyNumber: 'MT-2025-00654', insuredName: '安心科技股份有限公司', incidentLocation: '新北市', incidentDate: new Date('2026-03-15'), commissionDate: new Date('2026-03-17'), insuranceType: '產品責任險', incidentCause: '產品瑕疵', estimatedAmount: 2_800_000, status: '未決', currentStage: stages[3] },
    { caseNumber: 'NF-2026-001', departmentId: 7, insuranceCompanyId: 13, policyNumber: 'TF-2026-00111', insuredName: '老字號食品行', incidentLocation: '台北市', incidentDate: new Date('2026-02-20'), commissionDate: new Date('2026-02-22'), insuranceType: '火險', incidentCause: '電線走火', estimatedAmount: 4_500_000, finalAmount: 4_200_000, actualFee: 120000, status: '已決', currentStage: stages[8], closeDate: new Date('2026-04-10') },
    { caseNumber: 'KL-2026-001', departmentId: 5, insuranceCompanyId: 1, policyNumber: 'CK-2026-00876', insuredName: '南台灣建設開發公司', incidentLocation: '高雄市前鎮區', incidentDate: new Date('2026-01-05'), commissionDate: new Date('2026-01-08'), insuranceType: '營造綜合險', incidentCause: '地震損害', estimatedAmount: 12_000_000, status: '未決', currentStage: stages[5] },
    { caseNumber: 'NL-2025-050', departmentId: 1, insuranceCompanyId: 14, policyNumber: 'FB-2024-01234', insuredName: '永豐建設股份有限公司', incidentLocation: '台中市', incidentDate: new Date('2025-10-20'), commissionDate: new Date('2025-10-25'), insuranceType: '安裝工程險', incidentCause: '施工意外', estimatedAmount: 6_000_000, finalAmount: 5_800_000, actualFee: 180000, status: '已決', currentStage: stages[8], closeDate: new Date('2026-02-28') },
    { caseNumber: 'NL-2025-049', departmentId: 1, insuranceCompanyId: 6, policyNumber: 'HT-2024-09876', insuredName: '精密儀器製造有限公司', incidentLocation: '新竹市', incidentDate: new Date('2025-09-15'), commissionDate: new Date('2025-09-18'), insuranceType: '電子設備險', incidentCause: '設備損壞', estimatedAmount: 900_000, status: '銷案', currentStage: stages[1], notes: '保戶不願配合' },
    { caseNumber: 'NB-2026-003', departmentId: 2, insuranceCompanyId: 9, policyNumber: 'SC-2026-00445', insuredName: '健康照護機構', incidentLocation: '台北市', incidentDate: new Date('2026-04-01'), commissionDate: new Date('2026-04-03'), insuranceType: '僱主責任險', incidentCause: '員工職災', estimatedAmount: 1_500_000, status: '未決', currentStage: stages[0] },
  ]

  for (const c of caseSeed) {
    // 金額欄位採 BigInt（對齊 ERD bigint）：建立前轉型
    const data: Record<string, unknown> = { ...c }
    if (data.estimatedAmount != null) data.estimatedAmount = BigInt(data.estimatedAmount as number)
    if (data.finalAmount != null) data.finalAmount = BigInt(data.finalAmount as number)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await prisma.case.create({ data: data as any })
  }

  // ── Case Assignments ──────────────────────────────────────────────────
  // 承辦人 emp ids（火險部承辦=13/16，高雄工程承辦=4）
  await prisma.caseAssignment.createMany({
    data: [
      { caseId: 1,  employeeId: 1,  role: '主辦', contributionRatio: 0.7 },
      { caseId: 1,  employeeId: 3,  role: '協辦', contributionRatio: 0.3 },
      { caseId: 2,  employeeId: 5,  role: '主辦', contributionRatio: 1.0 },
      { caseId: 3,  employeeId: 3,  role: '主辦', contributionRatio: 1.0 },
      { caseId: 4,  employeeId: 2,  role: '主辦', contributionRatio: 1.0 },
      { caseId: 5,  employeeId: 2,  role: '主辦', contributionRatio: 0.6 },
      { caseId: 5,  employeeId: 6,  role: '協辦', contributionRatio: 0.4 },
      { caseId: 6,  employeeId: 13, role: '主辦', contributionRatio: 1.0 },
      { caseId: 7,  employeeId: 4,  role: '主辦', contributionRatio: 1.0 },
      { caseId: 8,  employeeId: 1,  role: '主辦', contributionRatio: 1.0 },
      { caseId: 9,  employeeId: 3,  role: '主辦', contributionRatio: 1.0 },
      { caseId: 10, employeeId: 2,  role: '主辦', contributionRatio: 1.0 },
    ],
  })

  // ── Settlement for closed cases ───────────────────────────────────────
  const settlement6 = await prisma.settlement.create({
    data: { caseId: 6, reportDate: new Date('2026-04-08'), baseFee: 115000, travelExpense: 5000, totalFee: 120000 },
  })
  await prisma.settlementSplit.create({
    data: { settlementId: settlement6.id, employeeId: 13, ratio: 1.0, amount: 120000 },
  })

  const settlement8 = await prisma.settlement.create({
    data: { caseId: 8, reportDate: new Date('2026-02-26'), baseFee: 170000, travelExpense: 10000, totalFee: 180000 },
  })
  await prisma.settlementSplit.create({
    data: { settlementId: settlement8.id, employeeId: 1, ratio: 1.0, amount: 180000 },
  })

  // ── Case Number Sequences ─────────────────────────────────────────────
  // deptCode 對齊新部門代號
  await prisma.caseNumberSeq.createMany({
    data: [
      { deptCode: 'NL', nextSeq: 4 },
      { deptCode: 'NB', nextSeq: 4 },
      { deptCode: 'CL', nextSeq: 1 },
      { deptCode: 'CB', nextSeq: 1 },
      { deptCode: 'KL', nextSeq: 2 },
      { deptCode: 'KB', nextSeq: 1 },
      { deptCode: 'NF', nextSeq: 2 },
      { deptCode: 'KF', nextSeq: 1 },
    ],
  })

  // ── Sample Notifications ──────────────────────────────────────────────
  await prisma.notification.createMany({
    data: [
      { type: 'review_submitted', title: '文件送審通知', message: '案件 NL-2026-002 已送交複核', caseId: 2, targetRoles: 'dept_manager', isRead: false },
      { type: 'review_approved', title: '文件複核完成', message: '案件 NB-2026-001 文件已核准', caseId: 4, targetRoles: 'handler', isRead: true },
      { type: 'case_assigned', title: '新案件指派', message: '新案件 KL-2026-001 已指派至高雄工程部', caseId: 7, targetRoles: 'handler', isRead: false },
    ],
  })

  // ── Dispatch Queue（派案池：待取件 / 已取件 / 已成案）────────────────────
  // assignedBy 須具派案權限（dept_manager / admin_staff / vp）
  await prisma.dispatchQueue.createMany({
    data: [
      // 待取件（pool）
      { sourceType: '保險公司', sourceReference: '兆豐產物－台北商辦施工坍塌', insuranceCompanyId: 1, assignedDepartmentId: 1, assignmentNotes: '颱風後牆面坍塌，請儘速指派承辦', status: '待取件', assignedBy: 10 },
      { sourceType: '保險經紀人', sourceReference: '台灣保代－連鎖餐廳顧客滑倒受傷', insuranceCompanyId: 5, brokerCompanyId: 1, assignedDepartmentId: 2, assignmentNotes: '公共意外責任，金額不大', status: '待取件', assignedBy: 8 },
      { sourceType: '保險公司', sourceReference: '兆豐產物－高雄廠房機械受損', insuranceCompanyId: 1, assignedDepartmentId: 5, assignmentNotes: '地震受損，需現場勘查', status: '待取件', assignedBy: 18 },
      { sourceType: '保險公司', sourceReference: '臺灣產物－倉庫夜間火災', insuranceCompanyId: 13, assignedDepartmentId: 7, assignmentNotes: '夜間電線走火，損失待估', status: '待取件', assignedBy: 15 },
      // 已取件（picked，承辦人處理中）
      { sourceType: '保險公司', sourceReference: '新安東京－辦公大樓電子設備毀損', insuranceCompanyId: 3, assignedDepartmentId: 1, assignmentNotes: '已由王小明取件處理中', status: '已取件', assignedBy: 10, pickedBy: 1 },
    ],
  })

  // 已成案：建立派案並回連既有案件 NB-2026-003（case10）
  const dispatchClosed = await prisma.dispatchQueue.create({
    data: { sourceType: '保險經紀人', sourceReference: '宏泰保代－員工職災', insuranceCompanyId: 9, brokerCompanyId: 2, assignedDepartmentId: 2, assignmentNotes: '已成案 NB-2026-003', status: '已成案', assignedBy: 8, pickedBy: 2 },
  })
  await prisma.case.update({
    where: { caseNumber: 'NB-2026-003' },
    data: { dispatchEntryId: dispatchClosed.id },
  })

  // ── Case Reviews（送審/審核，涵蓋各狀態 + 三關卡特殊案件）─────────────────
  // 部門主管 reviewer：dept1=7, dept2=8, dept5=18；加簽審核（高雄工程部主管）=18；VP=9
  await prisma.caseReview.createMany({
    data: [
      // R1 待複核（case4 NB-2026-001，承辦 emp2，複核 dept2 主管 emp8）
      { caseId: 4, documentType: '初步報告', submittedBy: 2, submittedAt: new Date('2026-05-28'), submissionNotes: '初步報告已完成，請主管複核', checkedDocuments: JSON.stringify(['出險照片', '保單影本', '初步損失估算']), reviewerId: 8, reviewStatus: '待複核', requiresVP: false, requiresMidApproval: false },
      // R2 待執行副總閱（case7 KL，複核通過且需 VP 閱示）
      { caseId: 7, documentType: '理算報告書', submittedBy: 4, submittedAt: new Date('2026-05-20'), submissionNotes: '理算報告書送審', checkedDocuments: JSON.stringify(['理算報告書', '損失清單', '估價單']), reviewerId: 18, reviewStatus: '已核准', reviewRemarks: '內容無誤', reviewedAt: new Date('2026-05-23'), approverId: null, approvalStatus: '待執行副總閱', requiresVP: true, requiresMidApproval: false },
      // R3 已核准（case2 NL，無需 VP，單關完成）
      { caseId: 2, documentType: '初步報告', submittedBy: 5, submittedAt: new Date('2026-03-01'), submissionNotes: '初步報告', checkedDocuments: JSON.stringify(['出險照片', '初步損失估算']), reviewerId: 7, reviewStatus: '已核准', reviewRemarks: '同意', reviewedAt: new Date('2026-03-04'), requiresVP: false, requiresMidApproval: false },
      // R4 退回（case5 NB，理算表遭退回 → cases 列表 hasRejectedReview）
      { caseId: 5, documentType: '理算表', submittedBy: 2, submittedAt: new Date('2026-05-10'), submissionNotes: '理算表送審', checkedDocuments: JSON.stringify(['理算表']), reviewerId: 8, reviewStatus: '退回', reviewRemarks: '理算金額與保單條款不符，請重新核算後再送', reviewedAt: new Date('2026-05-12'), requiresVP: false, requiresMidApproval: false },
      // R5 三關卡特殊案件（case1 NL 特殊案件：主管複核通過 → 待加簽審核 emp18 審核 → 之後 VP）
      { caseId: 1, documentType: '理算報告書', submittedBy: 1, submittedAt: new Date('2026-05-15'), submissionNotes: '特殊案件理算報告書，依 FR-90 三關卡審核', checkedDocuments: JSON.stringify(['理算報告書', '特殊案件審查表', '損失清單']), reviewerId: 7, reviewStatus: '已核准', reviewRemarks: '主管複核通過，轉中間加簽審核', reviewedAt: new Date('2026-05-18'), requiresMidApproval: true, midApproverId: 18, midApprovalStatus: '待加簽審核', requiresVP: true },
    ],
  })

  // ── Fee Targets（業績目標：2025 參考年 + 2026 設定年）────────────────────
  // setBy 為該員工部門主管：dept1=7, dept2=8, dept5=18, dept7=15, dept8=17
  const setAt2025 = new Date('2025-01-10')
  const setAt2026 = new Date('2026-01-15')
  await prisma.feeTarget.createMany({
    data: [
      { employeeId: 1,  year: 2025, targetAmount: 1_200_000, targetCaseCount: 30, setBy: 7,  setAt: setAt2025 },
      { employeeId: 1,  year: 2026, targetAmount: 1_500_000, targetCaseCount: 35, setBy: 7,  setAt: setAt2026 },
      { employeeId: 3,  year: 2025, targetAmount: 1_000_000, targetCaseCount: 25, setBy: 7,  setAt: setAt2025 },
      { employeeId: 3,  year: 2026, targetAmount: 1_200_000, targetCaseCount: 28, setBy: 7,  setAt: setAt2026 },
      { employeeId: 5,  year: 2025, targetAmount: 1_600_000, targetCaseCount: 38, setBy: 7,  setAt: setAt2025 },
      { employeeId: 5,  year: 2026, targetAmount: 1_800_000, targetCaseCount: 42, setBy: 7,  setAt: setAt2026 },
      { employeeId: 11, year: 2026, targetAmount: 500_000,   targetCaseCount: 12, setBy: 7,  setAt: setAt2026 },
      { employeeId: 2,  year: 2025, targetAmount: 800_000,   targetCaseCount: 20, setBy: 8,  setAt: setAt2025 },
      { employeeId: 2,  year: 2026, targetAmount: 1_000_000, targetCaseCount: 24, setBy: 8,  setAt: setAt2026 },
      { employeeId: 4,  year: 2026, targetAmount: 900_000,   targetCaseCount: 22, setBy: 18, setAt: setAt2026 },
      { employeeId: 13, year: 2026, targetAmount: 700_000,   targetCaseCount: 18, setBy: 15, setAt: setAt2026 },
      { employeeId: 16, year: 2026, targetAmount: 600_000,   targetCaseCount: 15, setBy: 17, setAt: setAt2026 },
    ],
  })

  // ── Case Progress（案件流程進度：依各案 currentStage 補齊時間軸）──────────
  const progressPlan = [
    { caseId: 1,  createdBy: 1,  upto: 2, baseDate: '2026-01-20' },
    { caseId: 2,  createdBy: 5,  upto: 4, baseDate: '2026-02-12' },
    { caseId: 4,  createdBy: 2,  upto: 1, baseDate: '2026-02-01' },
    { caseId: 7,  createdBy: 4,  upto: 5, baseDate: '2026-01-08' },
    { caseId: 6,  createdBy: 13, upto: 8, baseDate: '2026-02-22' },
    { caseId: 8,  createdBy: 1,  upto: 8, baseDate: '2025-10-25' },
  ]
  const progressRows: { caseId: number; stage: string; progressDate: Date; description: string; createdBy: number }[] = []
  for (const p of progressPlan) {
    for (let i = 0; i <= p.upto; i++) {
      const d = new Date(p.baseDate)
      d.setDate(d.getDate() + i * 5)
      progressRows.push({ caseId: p.caseId, stage: stages[i], progressDate: d, description: `${stages[i]} 階段作業完成`, createdBy: p.createdBy })
    }
  }
  await prisma.caseProgress.createMany({ data: progressRows })

  // ── Case Notes（備忘紀錄）─────────────────────────────────────────────
  await prisma.caseNote.createMany({
    data: [
      { caseId: 1, createdBy: 1, noteDate: new Date('2026-01-25'), content: '已聯繫保戶安排現場勘查，預計下週進行。' },
      { caseId: 2, createdBy: 5, noteDate: new Date('2026-03-02'), content: '中間報告已提送，等待主管複核。' },
      { caseId: 4, createdBy: 2, noteDate: new Date('2026-02-05'), content: '保戶補件中，待收齊單據後續辦理理算。' },
      { caseId: 7, createdBy: 4, noteDate: new Date('2026-01-15'), content: '地震損害範圍大，需協調結構技師共同會勘。' },
    ],
  })

  // ── Case Logs（修改/稽核紀錄）──────────────────────────────────────────
  await prisma.caseLog.createMany({
    data: [
      { caseId: 1, employeeId: 1, changedAt: new Date('2026-02-01'), fieldName: '案件階段', oldValue: '初步報告', newValue: '理算表', logType: 'edit' },
      { caseId: 1, employeeId: 1, changedAt: new Date('2026-05-15'), fieldName: '預估公證費', oldValue: '0', newValue: '147000', logType: 'interim_add', amount: 147000 },
      { caseId: 2, employeeId: 5, changedAt: new Date('2026-02-25'), fieldName: '案件階段', oldValue: '發函', newValue: '中間報告', logType: 'edit' },
      { caseId: 7, employeeId: 4, changedAt: new Date('2026-02-10'), fieldName: '理算損失額', oldValue: '', newValue: '11500000', logType: 'edit' },
    ],
  })

  // ── Case Co-Insurers（共保案件：case7 主承保 50%，共保兩家合計 50%）────────
  await prisma.caseCoInsurer.createMany({
    data: [
      { caseId: 7, companyId: 2, policyNumber: 'NS-CO-2026-001', ratio: 0.3 },
      { caseId: 7, companyId: 3, policyNumber: 'NA-CO-2026-002', ratio: 0.2 },
    ],
  })

  console.log('✅ Seed completed!')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
