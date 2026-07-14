'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Card, Table, Select, Typography, Row, Col, Tabs, Tag, Button, message,
} from 'antd'
import { FileExcelOutlined } from '@ant-design/icons'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title, Text } = Typography
const { Option } = Select

const PRIMARY_COLOR = '#1B4F8C'
const SECONDARY_COLOR = '#2E86C1'
const YEAR_RANGE = 5

interface EmployeePerformance {
  employeeId: number
  name: string
  openCount: number
  closedCount: number
  openFee: number
  closedFee: number
}

interface DeptMonthly {
  departmentId: number
  name: string
  months: number[]
  total: number
}

interface ReportData {
  year: number
  employeePerformance: EmployeePerformance[]
  deptMonthly: DeptMonthly[]
  departments: { id: number; name: string }[]
  isWideRole: boolean
}

const fmtMoney = (v: number) => (v > 0 ? `$${v.toLocaleString()}` : '—')

export default function ReportsPage() {
  const { session } = useAuth()
  const currentYear = dayjs().year()
  const years = Array.from({ length: YEAR_RANGE }, (_, i) => currentYear - i)

  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [year, setYear] = useState(String(currentYear))
  const [deptId, setDeptId] = useState<string>('')
  const [exporting, setExporting] = useState(false)

  const isWideRole = session ? ['vp', 'sysadmin', 'admin_staff'].includes(session.role) : false

  const loadReport = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ year })
    if (deptId) params.set('deptId', deptId)
    const res = await api.get<ReportData>(`/api/reports?${params.toString()}`)
    if (res.success && res.data) setData(res.data)
    setLoading(false)
  }, [year, deptId])

  useEffect(() => { loadReport() }, [loadReport])

  // 匯出 Excel（與畫面相同年份/部門篩選；含員工績效＋接案件數兩個工作表）
  async function handleExport() {
    setExporting(true)
    try {
      const params = new URLSearchParams({ year })
      if (deptId) params.set('deptId', deptId)
      const res = await fetch(`/api/reports/export?${params.toString()}`, { credentials: 'include' })
      if (!res.ok) { message.error('匯出失敗，請稍後再試'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `年度案件統計_${year}_${dayjs().format('YYYYMMDD')}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      message.error('匯出失敗，請稍後再試')
    } finally {
      setExporting(false)
    }
  }

  // ── 員工績效欄位 ──────────────────────────────────────────────────
  const perfColumns = [
    { title: '人員', dataIndex: 'name', key: 'name' },
    {
      title: '未決件數', dataIndex: 'openCount', key: 'openCount', width: 90, align: 'center' as const,
      render: (v: number) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '已決件數', dataIndex: 'closedCount', key: 'closedCount', width: 90, align: 'center' as const,
      render: (v: number) => <Tag color="green">{v}</Tag>,
    },
    {
      title: '未決公證費(預估)', dataIndex: 'openFee', key: 'openFee', align: 'right' as const,
      render: fmtMoney,
    },
    {
      title: '已決公證費', dataIndex: 'closedFee', key: 'closedFee', align: 'right' as const,
      render: fmtMoney,
    },
  ]

  const perfData = data?.employeePerformance ?? []

  const perfSummary = (rows: readonly EmployeePerformance[]) => {
    const sumOpen = rows.reduce((s, r) => s + r.openCount, 0)
    const sumClosed = rows.reduce((s, r) => s + r.closedCount, 0)
    const sumOpenFee = rows.reduce((s, r) => s + r.openFee, 0)
    const sumClosedFee = rows.reduce((s, r) => s + r.closedFee, 0)
    return (
      <Table.Summary fixed>
        <Table.Summary.Row style={{ background: '#fafafa' }}>
          <Table.Summary.Cell index={0} align="left"><Text strong>合計</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={1} align="center"><Text strong>{sumOpen}</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={2} align="center"><Text strong>{sumClosed}</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={3} align="right"><Text strong>{fmtMoney(sumOpenFee)}</Text></Table.Summary.Cell>
          <Table.Summary.Cell index={4} align="right"><Text strong>{fmtMoney(sumClosedFee)}</Text></Table.Summary.Cell>
        </Table.Summary.Row>
      </Table.Summary>
    )
  }

  // ── 接案件數欄位（部門 × 12 月份）──────────────────────────────────
  const deptMonthColumns = [
    { title: '部門', dataIndex: 'name', key: 'name', width: 130, fixed: 'left' as const },
    ...Array.from({ length: 12 }, (_, i) => i).map((m) => ({
      title: `${m + 1}月`,
      key: `m${m}`,
      width: 58,
      align: 'center' as const,
      render: (_: unknown, r: DeptMonthly) => (r.months[m] > 0 ? r.months[m] : '—'),
    })),
    {
      title: '年度合計', dataIndex: 'total', key: 'total', width: 90, align: 'center' as const,
      render: (v: number) => (v > 0 ? <strong>{v}</strong> : '—'),
    },
  ]

  const deptData = data?.deptMonthly ?? []

  const deptSummary = (rows: readonly DeptMonthly[]) => {
    const monthTotals = Array.from({ length: 12 }, (_, i) =>
      rows.reduce((s, r) => s + (r.months[i] ?? 0), 0)
    )
    const grandTotal = monthTotals.reduce((s, v) => s + v, 0)
    return (
      <Table.Summary fixed>
        <Table.Summary.Row style={{ background: '#fafafa' }}>
          <Table.Summary.Cell index={0} align="left"><Text strong>合計</Text></Table.Summary.Cell>
          {monthTotals.map((v, i) => (
            <Table.Summary.Cell key={i} index={i + 1} align="center">
              <Text strong>{v > 0 ? v : '—'}</Text>
            </Table.Summary.Cell>
          ))}
          <Table.Summary.Cell index={13} align="center">
            <Text strong>{grandTotal > 0 ? grandTotal : '—'}</Text>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      </Table.Summary>
    )
  }

  const yearSelect = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <Text type="secondary" style={{ fontSize: 13 }}>委託日年度</Text>
      <Select value={year} onChange={setYear} style={{ width: 110 }}>
        {years.map((y) => <Option key={y} value={String(y)}>{y} 年</Option>)}
      </Select>
    </span>
  )

  const deptSelect = isWideRole && (
    <Select
      placeholder="全部部門"
      style={{ width: 160 }}
      value={deptId || undefined}
      onChange={(v) => setDeptId(v ?? '')}
      allowClear
    >
      {(data?.departments ?? []).map((d) => <Option key={d.id} value={String(d.id)}>{d.name}</Option>)}
    </Select>
  )

  const tabItems = [
    {
      key: 'performance',
      label: '員工績效',
      children: (
        <>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Row gutter={[8, 8]} align="middle">
              <Col>{yearSelect}</Col>
              {deptSelect && <Col>{deptSelect}</Col>}
            </Row>
          </Card>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}>
              <Card title="各員工案件統計" size="small" bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                <Table
                  dataSource={perfData}
                  columns={perfColumns}
                  rowKey="employeeId"
                  loading={loading}
                  size="small"
                  bordered
                  pagination={false}
                  summary={perfSummary}
                />
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                  註：未決件數、已決件數僅計主辦；未決、已決公證費依承辦比例分攤。
                </Text>
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card title="員工案件數比較" size="small" bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
                {/* [2026/07/14] - Lisa - 固定每條 bar 粗細，圖表高度隨人數動態成長（卡片變高、不捲動） */}
                <ResponsiveContainer width="100%" height={Math.max(280, perfData.length * 36 + 60)}>
                  <BarChart data={perfData} layout="vertical" margin={{ left: 20 }} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="openCount" name="未決" fill={SECONDARY_COLOR} barSize={10} />
                    <Bar dataKey="closedCount" name="已決" fill={PRIMARY_COLOR} barSize={10} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </Col>
          </Row>
        </>
      ),
    },
    {
      key: 'cases',
      label: '接案件數',
      children: (
        <>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Row gutter={[8, 8]} align="middle">
              <Col>{yearSelect}</Col>
              {deptSelect && <Col>{deptSelect}</Col>}
            </Row>
          </Card>
          <Card
            title={`${year} 年各部門接案件數（依委託日）`}
            size="small"
            bordered={false}
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
          >
            <Table
              dataSource={deptData}
              columns={deptMonthColumns}
              rowKey="departmentId"
              loading={loading}
              size="small"
              bordered
              pagination={false}
              scroll={{ x: 900 }}
              summary={deptSummary}
            />
          </Card>
        </>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col><Title level={4} style={{ margin: 0 }}>年度案件統計</Title></Col>
        <Col>
          <Button
            icon={<FileExcelOutlined />}
            onClick={handleExport}
            loading={exporting}
            disabled={loading || !data}
          >
            匯出 Excel
          </Button>
        </Col>
      </Row>
      <Tabs items={tabItems} />
    </div>
  )
}
