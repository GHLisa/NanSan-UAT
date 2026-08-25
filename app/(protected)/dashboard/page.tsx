'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card, Row, Col, Statistic, Table, Tag, Space, Typography, Spin, Button, Tooltip,
} from 'antd'
import {
  ClockCircleOutlined, InboxOutlined, WarningOutlined, AlertOutlined,
} from '@ant-design/icons'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title, Text } = Typography

// FR-73 / FSD §5.4：7 個流程節點（移除「中間報告」「請款單填寫」）。
// 未列節點之案件自然不顯示（對齊 demo 以清單 filter 的用法）。
const STAGE_ORDER = [
  '進件/建檔', '初步報告', '理算表', '發函',
  '理算說明/協商', '正式結案報告', '結案',
]

const SLA_EMOJI: Record<string, { emoji: string; text: string }> = {
  red:    { emoji: '🔴', text: '逾期 30 天以上未完成初報' },
  yellow: { emoji: '🟡', text: '逾期 14 天以上未完成初報' },
}

// [2026/08/05] - Lisa - 停泊狀態色（與案件管理清單一致）
const PARKING_COLOR: Record<string, string> = { '訴訟中': 'red', '申訴中': 'orange', '待請求時效': 'blue' }

interface KPI {
  pendingCount: number
  pendingLabel: string
  openCount: number
  // [2026/08/04] - Lisa - 未決件數主辦/協辦拆分（僅承辦人有值，其他角色為 null）
  openCountPrimary: number | null
  openCountAssist: number | null
  yearlyFee: number
  feeAchieveRate: number | null
  countAchieveRate: number | null
  caseScope: string
  feeScope: string
}

interface PendingReview {
  id: number; caseId: number; caseNumber: string; insuredName: string
  handlerName: string; documentType: string; reviewStatus: string
  approvalStatus: string | null; midApprovalStatus: string | null; submittedAt: string
}

// [2026/08/05] - Lisa - SLA 預警改四段（停泊／初報逾期／結報期限／長期未決）
interface SlaItem {
  id: number; caseNumber: string; insuredName: string; handlerName: string
  commissionDate: string; currentStage: string; daysSince: number
  slaStatus?: 'red' | 'yellow'
  approvedAt?: string; daysLeft?: number   // 結報期限段：節點6 核定日與剩餘天數
  parkingStatus?: string                   // 停泊段
}

interface SlaSections {
  prelim: { total: number; items: SlaItem[] }
  closingReport: { total: number; items: SlaItem[] }
  longOpen: { total: number; items: SlaItem[] }
  parked: { total: number; items: SlaItem[] }
}

interface StatuteWarning {
  id: number; caseNumber: string; insuredName: string; handlerName: string
  commissionDate: string; expiryDate: string; daysLeft: number
}

// [2026/08/25] - Lisa - 案件紀錄填寫 & 未落實流程送審 提醒
interface ProcessReminderItem {
  id: number; caseNumber: string; insuredName: string; handlerName: string
  commissionDate: string; currentStage: string; daysSince: number
}

interface ProcessReminders {
  prelimNoteStuck: { total: number; items: ProcessReminderItem[] }
  noteMissing: { total: number; items: ProcessReminderItem[] }
}

// [2026/08/05] - Lisa - 待辦提醒（P1 初報期限 / P2 待結案）
interface PrelimReminder {
  id: number; caseNumber: string; insuredName: string; handlerName: string
  commissionDate: string; currentStage: string; daysLeft: number
}

interface CloseReminder {
  id: number; caseNumber: string; insuredName: string; handlerName: string
  approvedAt: string; currentStage: string; daysLeft: number
}

interface Reminders {
  prelim: { total: number; items: PrelimReminder[] }
  close: { total: number; items: CloseReminder[] }
}

interface MonthlyData { month: string; 新受理: number; 已結案: number }
interface StageItem { stage: string; count: number }

interface DashboardData {
  kpi: KPI
  pendingReviews: PendingReview[]
  reminders: Reminders
  slaSections: SlaSections
  statuteWarnings: StatuteWarning[]
  processReminders: ProcessReminders
  monthlyData: MonthlyData[]
  stageDistribution: StageItem[]
}

function AchieveRate({ value, label }: { value: number | null; label: string }) {
  // [2026/07/16] - Lisa - 未設定該項目標時（value 為 null）改顯示「未設定目標」，避免誤會成無資料
  const isSet = value != null
  const color = !isSet ? '#bfbfbf' : value >= 100 ? '#52c41a' : value >= 70 ? '#faad14' : '#ff4d4f'
  return (
    <Statistic
      title={<span style={{ fontSize: 11 }}>{label}</span>}
      value={isSet ? value : '未設定目標'}
      suffix={isSet ? '%' : ''}
      valueStyle={{ fontSize: isSet ? 22 : 13, color }}
    />
  )
}

// [2026/08/05] - Lisa - 待辦事項／SLA 預警共用的段落標題（左色條＋段名＋規則註記＋件數＋該段查看全部）
// note＝該段的判定規則，直接寫在標題旁，避免使用者要問「這段是怎麼算出來的」
function TodoSection({ color, title, note, total, shown, onViewAll, children }: {
  color: string; title: string; note?: string; total: number; shown: number
  onViewAll: () => void; children: React.ReactNode
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Row justify="space-between" align="middle" style={{ borderLeft: `3px solid ${color}`, paddingLeft: 8, marginBottom: 4 }}>
        <Col>
          <Text strong style={{ fontSize: 13 }}>{title}</Text>
          <Tag color={color} style={{ marginLeft: 6, fontSize: 11 }}>{total} 件</Tag>
          {note && <Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>{note}</Text>}
        </Col>
        <Col><Button type="link" size="small" onClick={onViewAll}>查看全部</Button></Col>
      </Row>
      {children}
      {total > shown && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>… 還有 {total - shown} 件</Text>
      )}
    </div>
  )
}

// 期限標示：逾期紅、3 天內橘、其餘中性
function DueTag({ daysLeft }: { daysLeft: number }) {
  if (daysLeft < 0) return <Tag color="red" style={{ fontSize: 11, fontWeight: 600 }}>逾期 {Math.abs(daysLeft)} 天</Tag>
  if (daysLeft === 0) return <Tag color="orange" style={{ fontSize: 11, fontWeight: 600 }}>今天到期</Tag>
  if (daysLeft <= 3) return <Tag color="orange" style={{ fontSize: 11 }}>剩 {daysLeft} 天</Tag>
  return <Text type="secondary" style={{ fontSize: 12 }}>剩 {daysLeft} 天</Text>
}

export default function DashboardPage() {
  const router = useRouter()
  const { session } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  // 依角色可視範圍（role/部門/組別）為依賴：右上角身分切換後 session 更新即重抓，
  // 避免停留在 /dashboard 時元件未重新掛載、待辦事項仍顯示舊角色資料。
  useEffect(() => {
    setLoading(true)
    api.get<DashboardData>('/api/dashboard').then((res) => {
      if (res.success && res.data) setData(res.data)
      setLoading(false)
    })
  }, [session?.role, session?.departmentId, session?.teamGroup])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!data) return null

  const { kpi } = data

  const stageData = STAGE_ORDER.map(stage => {
    const found = data.stageDistribution.find(s => s.stage === stage)
    return { stage, 件數: found?.count ?? 0 }
  })

  const showReviews = ['handler', 'team_lead', 'dept_manager', 'vp'].includes(session?.role ?? '')
  // [2026/08/04] - Lisa - 待辦事項「查看全部」導向與該角色待辦相符的清單：
  //   承辦人（退回待修）→ 案件管理並套用「退回待修」預警篩選（文件審核頁無此清單）
  //   組長/部門主管（待主管複核）、執行副總（待執行副總閱示）→ 文件審核（其預設 Tab 即為該待辦）
  const pendingAllPath = session?.role === 'handler' ? '/cases?alert=returned' : '/reviews'
  // [2026/08/05] - Lisa - 待辦事項三段：每段最多 3 筆，總件數放在卡片標題
  const REMINDER_PREVIEW = 3
  // 舊快取／舊部署回傳無 reminders 欄位時的防呆（避免 undefined 讀取）
  const reminders: Reminders = data.reminders ?? { prelim: { total: 0, items: [] }, close: { total: 0, items: [] } }
  const pendingPreview = data.pendingReviews.slice(0, REMINDER_PREVIEW)
  const todoTotal = kpi.pendingCount + reminders.prelim.total + reminders.close.total
  // [2026/08/05] - Lisa - SLA 四段（同一案件只歸一段）
  const emptySection = { total: 0, items: [] as SlaItem[] }
  const slaSections: SlaSections = data.slaSections ?? {
    prelim: emptySection, closingReport: emptySection, longOpen: emptySection, parked: emptySection,
  }
  const slaTotal =
    slaSections.prelim.total + slaSections.closingReport.total +
    slaSections.longOpen.total + slaSections.parked.total
  // 待辦事項各段的規則註記（審核類待辦依角色而異）
  const pendingNote =
    session?.role === 'handler' ? '審核退回，待修正後重送'
      : session?.role === 'vp' ? '已送至執行副總關卡待閱示'
        : '本部門送審文件待複核'
  // [2026/06/18] - Lisa - Issue #4 審核角色待辦點公證編號導向文件審核明細（?from=reviews）- Start
  const isReviewer = ['team_lead', 'dept_manager', 'vp'].includes(session?.role ?? '')
  // [2026/06/18] - Lisa - Issue #4 審核角色待辦點公證編號導向文件審核明細（?from=reviews）- end
  // [2026/06/24] - Lisa - 兩年時效預警改為比照 SLA 預警：無案件時仍顯示卡片（空狀態），原 FR-83「不渲染」改為中性樣式空卡
  const hasStatuteWarnings = data.statuteWarnings.length > 0
  // [2026/08/25] - Lisa - 案件紀錄填寫 & 未落實流程送審 提醒（舊快取／舊部署回傳無此欄位時的防呆）
  const emptyProcessSection = { total: 0, items: [] as ProcessReminderItem[] }
  const processReminders: ProcessReminders = data.processReminders ?? {
    prelimNoteStuck: emptyProcessSection, noteMissing: emptyProcessSection,
  }
  const processReminderTotal = processReminders.prelimNoteStuck.total + processReminders.noteMissing.total

  // ── Table columns ─────────────────────────────────────────────────────
  const reviewColumns = [
    {
      title: '公證編號', dataIndex: 'caseNumber', key: 'caseNumber',
      // [2026/06/18] - Lisa - Issue #4 審核角色導向審核模式明細（?from=reviews）；承辦人維持一般明細 - Start
      render: (v: string, r: PendingReview) => (
        <a onClick={() => router.push(`/cases/${r.caseId}${isReviewer ? '?from=reviews' : '?from=dashboard'}`)} style={{ color: '#1B4F8C', fontWeight: 600 }}>{v}</a>
      ),
      // [2026/06/18] - Lisa - Issue #4 審核角色導向審核模式明細（?from=reviews）；承辦人維持一般明細 - end
    },
    {
      title: '被保險人', dataIndex: 'insuredName', key: 'insuredName',
    },
    {
      title: '主承辦人', dataIndex: 'handlerName', key: 'handlerName',
    },
    { title: '文件類型', dataIndex: 'documentType', key: 'documentType', width: 120 },
    {
      title: '狀態', key: 'status', width: 100,
      render: (_: unknown, r: PendingReview) => {
        // [2026/06/18] - Lisa - Issue #11 任一關卡（主管/加簽審核/執行副總）退回皆顯示「退回」
        const isRejected = r.reviewStatus === '退回' || r.midApprovalStatus === '退回' || r.approvalStatus === '退回'
        const status = isRejected ? '退回'
          : r.approvalStatus === '待執行副總閱' ? '待執行副總閱'
          : r.reviewStatus
        return <Tag color={status === '退回' ? 'red' : 'blue'}>{status}</Tag>
      },
    },
    {
      title: '送審日', dataIndex: 'submittedAt', key: 'submittedAt', width: 80,
      render: (v: string) => dayjs(v).format('MM/DD'),
    },
  ]

  // [2026/08/05] - Lisa - SLA 四段共用的欄位積木（各段只挑需要的組合）
  const slaCaseNoCol = {
    title: '公證編號', dataIndex: 'caseNumber', key: 'caseNumber',
    render: (v: string, r: SlaItem) => (
      <a onClick={() => router.push(`/cases/${r.id}?from=dashboard`)} style={{ color: '#1B4F8C', fontWeight: 600 }}>{v}</a>
    ),
  }
  const slaBaseCols = [
    slaCaseNoCol,
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName' },
    { title: '主承辦人', dataIndex: 'handlerName', key: 'handlerName' },
    {
      title: '委託日', dataIndex: 'commissionDate', key: 'commissionDate', width: 75,
      render: (v: string) => dayjs(v).format('MM/DD'),
    },
  ]
  const daysSinceCol = {
    title: '未決天數', key: 'daysSince', width: 80,
    render: (_: unknown, r: SlaItem) => (
      <Text style={{ fontSize: 12, color: '#ff4d4f', fontWeight: 600 }}>D+{r.daysSince}</Text>
    ),
  }
  const stageCol = { title: '目前階段', dataIndex: 'currentStage', key: 'currentStage', width: 110 }

  // 初報逾期：燈號 emoji ＋ D+N
  const slaPrelimColumns = [
    {
      title: '', key: 'sla', width: 36,
      render: (_: unknown, r: SlaItem) => {
        const info = SLA_EMOJI[r.slaStatus ?? 'yellow']
        return <Tooltip title={info.text}><span style={{ fontSize: 15 }}>{info.emoji}</span></Tooltip>
      },
    },
    ...slaBaseCols, daysSinceCol, stageCol,
  ]

  // 結報期限：節點6 核定日 ＋ 60 天倒數（逾期為負）
  const slaClosingColumns = [
    slaCaseNoCol,
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName' },
    { title: '主承辦人', dataIndex: 'handlerName', key: 'handlerName' },
    {
      title: '節點6核定日', dataIndex: 'approvedAt', key: 'approvedAt', width: 95,
      render: (v: string) => (v ? dayjs(v).format('MM/DD') : '—'),
    },
    {
      title: '期限', key: 'due', width: 95,
      render: (_: unknown, r: SlaItem) => <DueTag daysLeft={r.daysLeft ?? 0} />,
    },
    stageCol,
  ]

  // 長期未決：D+N（一律紅）
  const slaLongOpenColumns = [...slaBaseCols, daysSinceCol, stageCol]

  // 停泊：標示停泊狀態，不計逾期
  const slaParkedColumns = [
    slaCaseNoCol,
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName' },
    { title: '主承辦人', dataIndex: 'handlerName', key: 'handlerName' },
    {
      title: '停泊狀態', dataIndex: 'parkingStatus', key: 'parkingStatus', width: 100,
      render: (v: string) => <Tag color={PARKING_COLOR[v] ?? 'default'} style={{ fontSize: 11 }}>{v}</Tag>,
    },
    {
      title: '委託日', dataIndex: 'commissionDate', key: 'commissionDate', width: 75,
      render: (v: string) => dayjs(v).format('MM/DD'),
    },
    {
      title: '未決天數', key: 'daysSince', width: 80,
      render: (_: unknown, r: SlaItem) => <Text type="secondary" style={{ fontSize: 12 }}>D+{r.daysSince}</Text>,
    },
  ]

  // [2026/08/05] - Lisa - P1 初報期限（委託後 14 天內未完成節點2）
  const prelimColumns = [
    {
      title: '公證編號', dataIndex: 'caseNumber', key: 'caseNumber',
      render: (v: string, r: PrelimReminder) => (
        <a onClick={() => router.push(`/cases/${r.id}?from=dashboard`)} style={{ color: '#1B4F8C', fontWeight: 600 }}>{v}</a>
      ),
    },
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName' },
    { title: '主承辦人', dataIndex: 'handlerName', key: 'handlerName' },
    {
      title: '委託日', dataIndex: 'commissionDate', key: 'commissionDate', width: 75,
      render: (v: string) => dayjs(v).format('MM/DD'),
    },
    {
      title: '期限', key: 'due', width: 95,
      render: (_: unknown, r: PrelimReminder) => <DueTag daysLeft={r.daysLeft} />,
    },
    { title: '目前階段', dataIndex: 'currentStage', key: 'currentStage', width: 110 },
  ]

  // [2026/08/05] - Lisa - P2 待結案（節點7、8 皆核准後 14 天內完成節點9）
  const closeColumns = [
    {
      title: '公證編號', dataIndex: 'caseNumber', key: 'caseNumber',
      render: (v: string, r: CloseReminder) => (
        <a onClick={() => router.push(`/cases/${r.id}?from=dashboard`)} style={{ color: '#1B4F8C', fontWeight: 600 }}>{v}</a>
      ),
    },
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName' },
    { title: '主承辦人', dataIndex: 'handlerName', key: 'handlerName' },
    {
      title: '核准日', dataIndex: 'approvedAt', key: 'approvedAt', width: 75,
      render: (v: string) => dayjs(v).format('MM/DD'),
    },
    {
      title: '期限', key: 'due', width: 95,
      render: (_: unknown, r: CloseReminder) => <DueTag daysLeft={r.daysLeft} />,
    },
  ]

  const statuteColumns = [
    {
      title: '時效狀態', key: 'statute', width: 130,
      render: (_: unknown, r: StatuteWarning) => r.daysLeft <= 0
        ? <Tag color="red">已逾時效 {Math.abs(r.daysLeft)} 天</Tag>
        : <Tag color="volcano">{r.daysLeft} 天後到期</Tag>,
    },
    {
      title: '公證編號', dataIndex: 'caseNumber', key: 'caseNumber',
      render: (v: string, r: StatuteWarning) => (
        <a onClick={() => router.push(`/cases/${r.id}?from=dashboard`)} style={{ color: '#1B4F8C', fontWeight: 600 }}>{v}</a>
      ),
    },
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName' },
    { title: '主承辦人', dataIndex: 'handlerName', key: 'handlerName' },
    {
      title: '委託日', dataIndex: 'commissionDate', key: 'commissionDate', width: 95,
      render: (v: string) => dayjs(v).format('YYYY/MM/DD'),
    },
  ]

  // [2026/08/25] - Lisa - 案件紀錄填寫 & 未落實流程送審 提醒（兩段共用欄位積木）
  const processReminderBaseCols = [
    {
      title: '公證編號', dataIndex: 'caseNumber', key: 'caseNumber',
      render: (v: string, r: ProcessReminderItem) => (
        <a onClick={() => router.push(`/cases/${r.id}?from=dashboard`)} style={{ color: '#1B4F8C', fontWeight: 600 }}>{v}</a>
      ),
    },
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName' },
    { title: '主承辦人', dataIndex: 'handlerName', key: 'handlerName' },
    {
      title: '委託日', dataIndex: 'commissionDate', key: 'commissionDate', width: 75,
      render: (v: string) => dayjs(v).format('MM/DD'),
    },
  ]
  const prelimNoteStuckColumns = [
    ...processReminderBaseCols,
    { title: '目前階段', dataIndex: 'currentStage', key: 'currentStage', width: 100 },
  ]
  const noteMissingColumns = [
    ...processReminderBaseCols,
    {
      title: '未決天數', key: 'daysSince', width: 80,
      render: (_: unknown, r: ProcessReminderItem) => (
        <Text style={{ fontSize: 12, color: '#ff4d4f', fontWeight: 600 }}>D+{r.daysSince}</Text>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 24 }}>儀表板</Title>

      {/* ── KPI Cards ─────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} align="stretch" style={{ marginBottom: 24 }}>
        {/* Card 1: 待辦 */}
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ height: '100%' }}>
            <Statistic
              title={
                <span>
                  {kpi.pendingLabel}
                  <br />
                  <Text type="secondary" style={{ fontSize: 11 }}>統計範圍：{kpi.caseScope}</Text>
                </span>
              }
              value={kpi.pendingCount}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#faad14', fontSize: 28 }}
            />
          </Card>
        </Col>

        {/* Card 2: 未決件數 */}
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ height: '100%' }}>
            <Statistic
              title={
                <span>
                  未決件數
                  <br />
                  <Text type="secondary" style={{ fontSize: 11 }}>統計範圍：{kpi.caseScope}</Text>
                </span>
              }
              value={kpi.openCount}
              prefix={<InboxOutlined />}
              valueStyle={{ color: '#1890ff', fontSize: 28 }}
            />
            {/* [2026/08/04] - Lisa - 主數字維持總計（同一案件只計一次），下方標示主辦/協辦組成；
                非承辦人角色為部門/組別統計，後端回傳 null 即不顯示 */}
            {kpi.openCountPrimary != null && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                主辦 {kpi.openCountPrimary} 件 ／ 協辦 {kpi.openCountAssist} 件
              </Text>
            )}
          </Card>
        </Col>

        {/* Card 3: 年度已決公證費 */}
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ height: '100%' }}>
            <Statistic
              title={
                <span>
                  年度已決公證費
                  <br />
                  <Text type="secondary" style={{ fontSize: 11 }}>統計範圍：{kpi.feeScope}</Text>
                </span>
              }
              value={kpi.yearlyFee}
              prefix="$"
              valueStyle={{ color: '#52c41a', fontSize: 28 }}
              formatter={v => Number(v).toLocaleString()}
            />
          </Card>
        </Col>

        {/* Card 4: 年度達成率 */}
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ height: '100%' }}>
            <div style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)' }}>年度達成率</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 11 }}>統計範圍：{kpi.feeScope}</Text>
            </div>
            <Row>
              <Col span={12} style={{ borderRight: '1px solid #f0f0f0', paddingRight: 8 }}>
                <AchieveRate value={kpi.feeAchieveRate} label="純公證費" />
              </Col>
              <Col span={12} style={{ paddingLeft: 8 }}>
                {/* [2026/08/04] - Lisa - FR-110 結案件數只計主辦，標籤標示以免與含協辦的件數混淆 */}
                <AchieveRate value={kpi.countAchieveRate} label="結案件數(主辦)" />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <Row gutter={[16, 16]}>
        {/* Left: 待辦事項 + SLA 預警 */}
        <Col xs={24} xl={14}>
          {/* [2026/08/05] - Lisa - 待辦事項改三段式：審核類待辦（角色語意）＋ P1 初報期限 ＋ P2 待結案。
              每段只顯示前 3 筆、各自「查看全部」導向對應清單；空的段落整段隱藏 */}
          {showReviews && (
            <Card
              title={
                <Space>
                  <ClockCircleOutlined style={{ color: '#faad14' }} />
                  <span>待辦事項{todoTotal > 0 ? `（${todoTotal}）` : ''}</span>
                </Space>
              }
              size="small"
              style={{ marginBottom: 16 }}
            >
              {todoTotal === 0 ? (
                <Text type="secondary" style={{ display: 'block', padding: '8px 0' }}>目前無待辦事項 ✅</Text>
              ) : (
                <>
                  {pendingPreview.length > 0 && (
                    <TodoSection
                      color="#faad14"
                      title={`📋 ${kpi.pendingLabel}`}
                      note={pendingNote}
                      total={kpi.pendingCount}
                      shown={pendingPreview.length}
                      onViewAll={() => router.push(pendingAllPath)}
                    >
                      <Table
                        dataSource={pendingPreview}
                        columns={reviewColumns}
                        rowKey="id"
                        size="small"
                        pagination={false}
                        scroll={{ x: 400 }}
                      />
                    </TodoSection>
                  )}

                  {reminders.prelim.items.length > 0 && (
                    <TodoSection
                      color="#1890ff"
                      title="⏱ 初報期限"
                      note="委託後 14 天內須完成初步報告（逾期見下方 SLA 預警）"
                      total={reminders.prelim.total}
                      shown={reminders.prelim.items.length}
                      onViewAll={() => router.push('/cases?alert=prelim14')}
                    >
                      <Table
                        dataSource={reminders.prelim.items}
                        columns={prelimColumns}
                        rowKey="id"
                        size="small"
                        pagination={false}
                        scroll={{ x: 460 }}
                      />
                    </TodoSection>
                  )}

                  {reminders.close.items.length > 0 && (
                    <TodoSection
                      color="#722ed1"
                      title="📕 待結案"
                      note="結案報告＋請款單核准後 14 天內須結案"
                      total={reminders.close.total}
                      shown={reminders.close.items.length}
                      onViewAll={() => router.push('/cases?alert=close14')}
                    >
                      <Table
                        dataSource={reminders.close.items}
                        columns={closeColumns}
                        rowKey="id"
                        size="small"
                        pagination={false}
                        scroll={{ x: 420 }}
                      />
                    </TodoSection>
                  )}
                </>
              )}
            </Card>
          )}

          {/* [2026/08/05] - Lisa - SLA 預警改四段：停泊／初報逾期／結報期限／長期未決。
              每段標題標註判定規則、各自「查看全部」；同一案件只列於最優先的一段 */}
          <Card
            title={
              <Space>
                <WarningOutlined style={{ color: '#ff4d4f' }} />
                <span>SLA 預警{slaTotal > 0 ? `（${slaTotal}）` : ''}</span>
              </Space>
            }
            size="small"
          >
            {slaTotal === 0 ? (
              <Text type="secondary" style={{ display: 'block', padding: '8px 0' }}>目前無 SLA 預警案件 ✅</Text>
            ) : (
              <>
                {slaSections.prelim.items.length > 0 && (
                  <TodoSection
                    color="#ff4d4f"
                    title="⏱ 初報逾期"
                    note="委託後滿 14 天仍未完成初步報告"
                    total={slaSections.prelim.total}
                    shown={slaSections.prelim.items.length}
                    onViewAll={() => router.push('/cases?alert=prelim_overdue')}
                  >
                    <Table dataSource={slaSections.prelim.items} columns={slaPrelimColumns}
                      rowKey="id" size="small" pagination={false} scroll={{ x: 500 }} />
                  </TodoSection>
                )}

                {slaSections.closingReport.items.length > 0 && (
                  <TodoSection
                    color="#fa8c16"
                    title="📐 結報期限"
                    note="理算說明/協商核定後 60 天內須完成結案報告"
                    total={slaSections.closingReport.total}
                    shown={slaSections.closingReport.items.length}
                    onViewAll={() => router.push('/cases?alert=closing60')}
                  >
                    <Table dataSource={slaSections.closingReport.items} columns={slaClosingColumns}
                      rowKey="id" size="small" pagination={false} scroll={{ x: 520 }} />
                  </TodoSection>
                )}

                {slaSections.longOpen.items.length > 0 && (
                  <TodoSection
                    color="#8c8c8c"
                    title="🕰 長期未決"
                    note="委託後滿 90 天仍未結案"
                    total={slaSections.longOpen.total}
                    shown={slaSections.longOpen.items.length}
                    onViewAll={() => router.push('/cases?alert=open90')}
                  >
                    <Table dataSource={slaSections.longOpen.items} columns={slaLongOpenColumns}
                      rowKey="id" size="small" pagination={false} scroll={{ x: 480 }} />
                  </TodoSection>
                )}

                {slaSections.parked.items.length > 0 && (
                  <TodoSection
                    color="#6B46C1"
                    title="⏸ 停泊案件"
                    note="訴訟中／申訴中／待請求時效，暫停計逾期"
                    total={slaSections.parked.total}
                    shown={slaSections.parked.items.length}
                    onViewAll={() => router.push('/cases?alert=parked')}
                  >
                    <Table dataSource={slaSections.parked.items} columns={slaParkedColumns}
                      rowKey="id" size="small" pagination={false} scroll={{ x: 500 }} />
                  </TodoSection>
                )}

                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                  同一案件只列於最優先的一段（停泊 → 初報逾期 → 結報期限 → 長期未決）
                </Text>
              </>
            )}
          </Card>
        </Col>

        {/* Right: 兩年時效預警 + 月度趨勢圖 */}
        <Col xs={24} xl={10}>
          {/* [2026/06/24] - Lisa - 比照 SLA 預警：一律渲染卡片，無案件時顯示空狀態（中性樣式，不掛紅色警示） */}
          {/* [2026/08/04] - Lisa - 查看全部改帶 ?alert=statute（卡片僅前 8 筆，清單為全部時效預警案件） */}
          <Card
            title={
              <Space>
                <AlertOutlined style={{ color: hasStatuteWarnings ? '#ff4d4f' : '#bfbfbf' }} />
                <span style={{ color: hasStatuteWarnings ? '#ff4d4f' : undefined, fontWeight: 600 }}>兩年時效預警</span>
                <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>30天內到期或已逾期</Text>
              </Space>
            }
            size="small"
            style={{ marginBottom: 16 }}
            styles={hasStatuteWarnings ? { header: { borderBottom: '2px solid #ff4d4f', background: '#fff2f0' } } : undefined}
            extra={<Button type="link" size="small" onClick={() => router.push('/cases?alert=statute')}>查看全部</Button>}
          >
            {hasStatuteWarnings ? (
              <Table
                dataSource={data.statuteWarnings}
                columns={statuteColumns}
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ x: 500 }}
                rowClassName={(r: StatuteWarning) => r.daysLeft <= 0 ? 'statute-expired-row' : ''}
              />
            ) : (
              <Text type="secondary" style={{ display: 'block', padding: '8px 0' }}>目前無兩年時效預警案件 ✅</Text>
            )}
          </Card>

          {/* [2026/08/25] - Lisa - 案件紀錄填寫 & 未落實流程送審 提醒：比照 SLA/時效預警，一律渲染卡片，
              無案件時顯示空狀態；兩段各自「查看全部」導向案件管理並套用對應預警篩選 */}
          <Card
            title={
              <Space>
                <WarningOutlined style={{ color: processReminderTotal > 0 ? '#fa8c16' : '#bfbfbf' }} />
                <span style={{ color: processReminderTotal > 0 ? '#fa8c16' : undefined, fontWeight: 600 }}>
                  案件紀錄填寫 & 未落實流程送審 提醒
                </span>
              </Space>
            }
            size="small"
            style={{ marginBottom: 16 }}
            styles={processReminderTotal > 0 ? { header: { borderBottom: '2px solid #fa8c16', background: '#fff7e6' } } : undefined}
          >
            {processReminderTotal === 0 ? (
              <Text type="secondary" style={{ display: 'block', padding: '8px 0' }}>目前無相關提醒案件 ✅</Text>
            ) : (
              <>
                {processReminders.prelimNoteStuck.items.length > 0 && (
                  <TodoSection
                    color="#ff4d4f"
                    title="🚩 未落實流程送審"
                    note="案件紀錄提到「初步報告」，但流程階段仍卡在進件/建檔"
                    total={processReminders.prelimNoteStuck.total}
                    shown={processReminders.prelimNoteStuck.items.length}
                    onViewAll={() => router.push('/cases?alert=prelimNoteStuck')}
                  >
                    <Table
                      dataSource={processReminders.prelimNoteStuck.items}
                      columns={prelimNoteStuckColumns}
                      rowKey="id"
                      size="small"
                      pagination={false}
                      scroll={{ x: 460 }}
                    />
                  </TodoSection>
                )}

                {processReminders.noteMissing.items.length > 0 && (
                  <TodoSection
                    color="#fa8c16"
                    title="📝 案件紀錄填寫"
                    note="初步報告已逾期（D+14 以上）且尚未填寫任何案件紀錄"
                    total={processReminders.noteMissing.total}
                    shown={processReminders.noteMissing.items.length}
                    onViewAll={() => router.push('/cases?alert=noteMissing')}
                  >
                    <Table
                      dataSource={processReminders.noteMissing.items}
                      columns={noteMissingColumns}
                      rowKey="id"
                      size="small"
                      pagination={false}
                      scroll={{ x: 460 }}
                    />
                  </TodoSection>
                )}
              </>
            )}
          </Card>

          <Card
            title={
              <span>
                月度受理 / 結案趨勢
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>統計範圍：{kpi.caseScope}</Text>
              </span>
            }
            size="small"
          >
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.monthlyData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <RechartsTooltip />
                <Legend />
                <Bar dataKey="新受理" fill="#1B4F8C" />
                <Bar dataKey="已結案" fill="#52c41a" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      {/* ── Stage Distribution ───────────────────────────────────────── */}
      <Row style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card
            size="small"
            title={
              <span>
                各階段案件分布
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>統計範圍：{kpi.caseScope}</Text>
              </span>
            }
          >
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stageData} margin={{ top: 10, right: 16, left: -10, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="stage" tick={{ fontSize: 12 }} interval={0} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <RechartsTooltip />
                <Bar dataKey="件數" fill="#2E86C1" radius={[3, 3, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
