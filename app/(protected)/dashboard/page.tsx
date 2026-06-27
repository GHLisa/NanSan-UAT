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

interface KPI {
  pendingCount: number
  pendingLabel: string
  openCount: number
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

interface SlaWarning {
  id: number; caseNumber: string; insuredName: string; handlerName: string
  commissionDate: string; currentStage: string; slaStatus: 'red' | 'yellow'
}

interface StatuteWarning {
  id: number; caseNumber: string; insuredName: string; handlerName: string
  commissionDate: string; expiryDate: string; daysLeft: number
}

interface MonthlyData { month: string; 新受理: number; 已結案: number }
interface StageItem { stage: string; count: number }

interface DashboardData {
  kpi: KPI
  pendingReviews: PendingReview[]
  slaWarnings: SlaWarning[]
  statuteWarnings: StatuteWarning[]
  monthlyData: MonthlyData[]
  stageDistribution: StageItem[]
}

function AchieveRate({ value, label }: { value: number | null; label: string }) {
  const color = value == null ? '#bfbfbf' : value >= 100 ? '#52c41a' : value >= 70 ? '#faad14' : '#ff4d4f'
  return (
    <Statistic
      title={<span style={{ fontSize: 11 }}>{label}</span>}
      value={value != null ? value : '—'}
      suffix={value != null ? '%' : ''}
      valueStyle={{ fontSize: 22, color }}
    />
  )
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
  // [2026/06/18] - Lisa - Issue #4 審核角色待辦點案件編號導向文件審核明細（?from=reviews）- Start
  const isReviewer = ['team_lead', 'dept_manager', 'vp'].includes(session?.role ?? '')
  // [2026/06/18] - Lisa - Issue #4 審核角色待辦點案件編號導向文件審核明細（?from=reviews）- end
  // [2026/06/24] - Lisa - 兩年時效預警改為比照 SLA 預警：無案件時仍顯示卡片（空狀態），原 FR-83「不渲染」改為中性樣式空卡
  const hasStatuteWarnings = data.statuteWarnings.length > 0

  // ── Table columns ─────────────────────────────────────────────────────
  const reviewColumns = [
    {
      title: '案件編號', dataIndex: 'caseNumber', key: 'caseNumber',
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
      title: '承辦人(主辦)', dataIndex: 'handlerName', key: 'handlerName',
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

  const slaColumns = [
    {
      title: '', key: 'sla', width: 36,
      render: (_: unknown, r: SlaWarning) => {
        const info = SLA_EMOJI[r.slaStatus]
        return <Tooltip title={info.text}><span style={{ fontSize: 15 }}>{info.emoji}</span></Tooltip>
      },
    },
    {
      title: '案件編號', dataIndex: 'caseNumber', key: 'caseNumber',
      render: (v: string, r: SlaWarning) => (
        <a onClick={() => router.push(`/cases/${r.id}?from=dashboard`)} style={{ color: '#1B4F8C', fontWeight: 600 }}>{v}</a>
      ),
    },
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName' },
    { title: '承辦人(主辦)', dataIndex: 'handlerName', key: 'handlerName' },
    {
      title: '委託日', dataIndex: 'commissionDate', key: 'commissionDate', width: 75,
      render: (v: string) => dayjs(v).format('MM/DD'),
    },
    { title: '目前階段', dataIndex: 'currentStage', key: 'currentStage', width: 110 },
  ]

  const statuteColumns = [
    {
      title: '時效狀態', key: 'statute', width: 130,
      render: (_: unknown, r: StatuteWarning) => r.daysLeft <= 0
        ? <Tag color="red">已逾時效 {Math.abs(r.daysLeft)} 天</Tag>
        : <Tag color="volcano">{r.daysLeft} 天後到期</Tag>,
    },
    {
      title: '案件編號', dataIndex: 'caseNumber', key: 'caseNumber',
      render: (v: string, r: StatuteWarning) => (
        <a onClick={() => router.push(`/cases/${r.id}?from=dashboard`)} style={{ color: '#1B4F8C', fontWeight: 600 }}>{v}</a>
      ),
    },
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName' },
    { title: '承辦人(主辦)', dataIndex: 'handlerName', key: 'handlerName' },
    {
      title: '委託日', dataIndex: 'commissionDate', key: 'commissionDate', width: 95,
      render: (v: string) => dayjs(v).format('YYYY/MM/DD'),
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
                <AchieveRate value={kpi.countAchieveRate} label="結案件數" />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <Row gutter={[16, 16]}>
        {/* Left: 待辦事項 + SLA 預警 */}
        <Col xs={24} xl={14}>
          {showReviews && (
            <Card
              title={<Space><ClockCircleOutlined style={{ color: '#faad14' }} /><span>待辦事項</span></Space>}
              size="small"
              style={{ marginBottom: 16 }}
              extra={<Button type="link" size="small" onClick={() => router.push('/reviews')}>查看全部</Button>}
            >
              {data.pendingReviews.length === 0 ? (
                <Text type="secondary" style={{ display: 'block', padding: '8px 0' }}>目前無待辦事項 ✅</Text>
              ) : (
                <Table
                  dataSource={data.pendingReviews}
                  columns={reviewColumns}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  scroll={{ x: 400 }}
                />
              )}
            </Card>
          )}

          <Card
            title={<Space><WarningOutlined style={{ color: '#ff4d4f' }} /><span>SLA 預警</span></Space>}
            size="small"
            extra={<Button type="link" size="small" onClick={() => router.push('/cases')}>查看全部</Button>}
          >
            {data.slaWarnings.length === 0 ? (
              <Text type="secondary" style={{ display: 'block', padding: '8px 0' }}>目前無 SLA 預警案件 ✅</Text>
            ) : (
              <Table
                dataSource={data.slaWarnings}
                columns={slaColumns}
                rowKey="id"
                size="small"
                pagination={false}
                scroll={{ x: 400 }}
              />
            )}
          </Card>
        </Col>

        {/* Right: 兩年時效預警 + 月度趨勢圖 */}
        <Col xs={24} xl={10}>
          {/* [2026/06/24] - Lisa - 比照 SLA 預警：一律渲染卡片，無案件時顯示空狀態（中性樣式，不掛紅色警示） */}
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
            extra={<Button type="link" size="small" onClick={() => router.push('/cases')}>查看全部</Button>}
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
