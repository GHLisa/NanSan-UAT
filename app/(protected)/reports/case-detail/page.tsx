'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card, Table, Select, Typography, Row, Col, Button, Tag,
} from 'antd'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title } = Typography
const { Option } = Select

interface SettlementItem {
  id: number
  caseId: number
  caseNumber: string
  insuredName: string
  insuranceType: string
  insuranceCompanyName: string
  departmentName: string
  reportDate: string
  baseFee: number
  travelExpense: number
  totalFee: number
  remarks: string | null
  handlers: { name: string; role: string }[]
}

interface MetaData {
  departments: { id: number; name: string }[]
}

export default function CaseDetailReportPage() {
  const router = useRouter()
  const { session } = useAuth()
  const currentYear = dayjs().year()
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  const [settlements, setSettlements] = useState<SettlementItem[]>([])
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState<MetaData>({ departments: [] })
  const [filters, setFilters] = useState({ year: String(currentYear), deptId: '' })

  const isVpOrAdmin = session && ['vp', 'sysadmin'].includes(session.role)

  const loadData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ year: filters.year })
    if (filters.deptId) params.set('deptId', filters.deptId)
    const res = await api.get<SettlementItem[]>(`/api/settlements?${params.toString()}`)
    if (res.success && res.data) setSettlements(res.data)
    setLoading(false)
  }, [filters])

  useEffect(() => {
    api.get<MetaData>('/api/meta').then((res) => {
      if (res.success && res.data) setMeta(res.data)
    })
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const columns = [
    {
      title: '案件編號',
      dataIndex: 'caseNumber',
      key: 'caseNumber',
      render: (v: string, r: SettlementItem) => (
        <Button type="link" size="small" onClick={() => router.push(`/cases/${r.caseId}`)}>{v}</Button>
      ),
    },
    { title: '被保人', dataIndex: 'insuredName', key: 'insuredName' },
    { title: '險種', dataIndex: 'insuranceType', key: 'type' },
    { title: '保險公司', dataIndex: 'insuranceCompanyName', key: 'ic' },
    ...(isVpOrAdmin ? [{ title: '部門', dataIndex: 'departmentName', key: 'dept' }] : []),
    {
      title: '結算日',
      dataIndex: 'reportDate',
      key: 'reportDate',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD'),
    },
    {
      title: '基本公證費',
      dataIndex: 'baseFee',
      key: 'baseFee',
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: '交通費',
      dataIndex: 'travelExpense',
      key: 'travel',
      align: 'right' as const,
      render: (v: number) => v ? v.toLocaleString() : '-',
    },
    {
      title: '實際公證費',
      dataIndex: 'totalFee',
      key: 'totalFee',
      align: 'right' as const,
      render: (v: number) => <strong>{v.toLocaleString()}</strong>,
    },
    {
      title: '承辦人',
      key: 'handlers',
      render: (_: unknown, r: SettlementItem) => (
        r.handlers.map((h) => (
          <Tag key={h.name} color={h.role === '主辦' ? 'blue' : 'default'} style={{ marginBottom: 2 }}>{h.name}</Tag>
        ))
      ),
    },
  ]

  const totalFee = settlements.reduce((s, item) => s + item.totalFee, 0)

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 16 }}>已決案明細表</Title>

      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}>
        <Row gutter={[12, 8]} align="middle">
          <Col xs={12} sm={6} md={4}>
            <Select style={{ width: '100%' }} value={filters.year} onChange={(v) => setFilters((f) => ({ ...f, year: v }))}>
              {years.map((y) => <Option key={y} value={String(y)}>{y} 年</Option>)}
            </Select>
          </Col>
          {isVpOrAdmin && (
            <Col xs={12} sm={6} md={4}>
              <Select
                placeholder="全部部門"
                style={{ width: '100%' }}
                value={filters.deptId || undefined}
                onChange={(v) => setFilters((f) => ({ ...f, deptId: v ?? '' }))}
                allowClear
              >
                {meta.departments.map((d) => <Option key={d.id} value={String(d.id)}>{d.name}</Option>)}
              </Select>
            </Col>
          )}
          <Col>
            <Button type="primary" onClick={loadData} style={{ background: '#1B4F8C' }}>查詢</Button>
          </Col>
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <span style={{ color: '#8c8c8c', marginRight: 8 }}>共 {settlements.length} 件</span>
            <span style={{ fontWeight: 600, color: '#1B4F8C' }}>公證費合計：{totalFee.toLocaleString()}</span>
          </Col>
        </Row>
      </Card>

      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Table
          dataSource={settlements}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="small"
          scroll={{ x: 1200 }}
          pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 筆` }}
        />
      </Card>
    </div>
  )
}
