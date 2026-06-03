'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Row, Col, Statistic, Table, Tag, Space, Typography, Spin, Button } from 'antd'
import {
  FileTextOutlined, CheckCircleOutlined, BellOutlined,
  AlertOutlined, WarningOutlined,
} from '@ant-design/icons'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title, Text } = Typography

const STAGE_ORDER = [
  '進件/建檔', '初步報告', '理算表', '發函', '中間報告',
  '理算說明/協商', '正式結案報告', '請款單填寫', '結案',
]

interface DashboardData {
  kpi: { totalCases: number; closedCases: number; pendingReviews: number; unreadNotifications: number; myCaseCount: number }
  stageDistribution: { stage: string; count: number }[]
  slaWarnings: { id: number; caseNumber: string; insuredName: string; departmentName: string; commissionDate: string; currentStage: string; daysSince: number }[]
  recentCases: { id: number; caseNumber: string; insuredName: string; status: string; currentStage: string; commissionDate: string }[]
}

export default function DashboardPage() {
  const router = useRouter()
  const { session } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<DashboardData>('/api/dashboard').then((res) => {
      if (res.success && res.data) setData(res.data)
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!data) return null

  const stageChartData = STAGE_ORDER.map((stage) => {
    const found = data.stageDistribution.find((s) => s.stage === stage)
    return { stage: stage.length > 5 ? stage.slice(0, 5) + '…' : stage, fullStage: stage, count: found?.count ?? 0 }
  })

  const slaColumns = [
    { title: '案件編號', dataIndex: 'caseNumber', key: 'caseNumber', render: (v: string, r: { id: number }) => (
      <Button type="link" size="small" onClick={() => router.push(`/cases/${r.id}`)}>{v}</Button>
    )},
    { title: '被保人', dataIndex: 'insuredName', key: 'insuredName' },
    { title: '部門', dataIndex: 'departmentName', key: 'departmentName' },
    { title: '超時天數', dataIndex: 'daysSince', key: 'daysSince', render: (v: number) => (
      <Tag color={v >= 30 ? 'red' : 'orange'}>{v} 天</Tag>
    )},
    { title: '目前階段', dataIndex: 'currentStage', key: 'currentStage' },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 24 }}>
        儀表板
        <Text type="secondary" style={{ fontSize: 14, fontWeight: 400, marginLeft: 12 }}>
          {dayjs().format('YYYY年MM月DD日')}
        </Text>
      </Title>

      {/* KPI 卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}>
          <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <Statistic
              title="未決案件數"
              value={data.kpi.totalCases}
              prefix={<FileTextOutlined style={{ color: '#1B4F8C' }} />}
              valueStyle={{ color: '#1B4F8C' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <Statistic
              title="已決案件數"
              value={data.kpi.closedCases}
              prefix={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <Statistic
              title={session?.role === 'vp' ? '待閱批件' : '待複核件'}
              value={data.kpi.pendingReviews}
              prefix={<AlertOutlined style={{ color: data.kpi.pendingReviews > 0 ? '#fa8c16' : '#8c8c8c' }} />}
              valueStyle={{ color: data.kpi.pendingReviews > 0 ? '#fa8c16' : '#8c8c8c' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <Statistic
              title="未讀通知"
              value={data.kpi.unreadNotifications}
              prefix={<BellOutlined style={{ color: data.kpi.unreadNotifications > 0 ? '#1B4F8C' : '#8c8c8c' }} />}
              valueStyle={{ color: '#1B4F8C' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {/* 各階段分布圖 */}
        <Col xs={24} lg={14}>
          <Card
            title={<Space><FileTextOutlined />未決案件各階段分布</Space>}
            bordered={false}
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stageChartData} margin={{ top: 8, right: 8, left: -20, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="stage" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v, _, props) => [v, (props.payload as { fullStage?: string })?.fullStage ?? '']} />
                <Bar dataKey="count" name="案件數" radius={[3, 3, 0, 0]}>
                  {stageChartData.map((_, i) => (
                    <Cell key={i} fill={i < 4 ? '#1B4F8C' : i < 7 ? '#2E86C1' : '#5BA8D4'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>

        {/* SLA 預警 */}
        <Col xs={24} lg={10}>
          <Card
            title={<Space><WarningOutlined style={{ color: '#fa8c16' }} />SLA 逾期預警（14 天無初報）</Space>}
            bordered={false}
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
            extra={data.slaWarnings.length > 0 && <Tag color="orange">{data.slaWarnings.length} 件</Tag>}
          >
            {data.slaWarnings.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#8c8c8c', padding: '40px 0' }}>✅ 目前無逾期案件</div>
            ) : (
              <Table
                dataSource={data.slaWarnings}
                columns={slaColumns}
                rowKey="id"
                pagination={false}
                size="small"
                scroll={{ y: 200 }}
              />
            )}
          </Card>
        </Col>

        {/* 最近案件 */}
        <Col xs={24}>
          <Card
            title="最近案件"
            bordered={false}
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
            extra={<Button type="link" onClick={() => router.push('/cases')}>查看全部</Button>}
          >
            <Table
              dataSource={data.recentCases}
              rowKey="id"
              pagination={false}
              size="small"
              columns={[
                { title: '案件編號', dataIndex: 'caseNumber', render: (v: string, r: { id: number }) => (
                  <Button type="link" size="small" onClick={() => router.push(`/cases/${r.id}`)}>{v}</Button>
                )},
                { title: '被保人', dataIndex: 'insuredName' },
                { title: '狀態', dataIndex: 'status', render: (v: string) => (
                  <Tag color={v === '已決' ? 'green' : v === '銷案' ? 'default' : 'blue'}>{v}</Tag>
                )},
                { title: '目前階段', dataIndex: 'currentStage' },
                { title: '受任日', dataIndex: 'commissionDate', render: (v: string) => dayjs(v).format('YYYY-MM-DD') },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
