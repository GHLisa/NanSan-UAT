'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Card, Table, Select, Typography, Row, Col, Button,
} from 'antd'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title } = Typography
const { Option } = Select

interface ReportData {
  year: number
  employeePerformance: { id: number; name: string; caseCount: number; totalFee: number }[]
  monthlyStats: { month: string; count: number; fee: number }[]
}

interface MetaData {
  departments: { id: number; name: string }[]
}

export default function ReportsPage() {
  const { session } = useAuth()
  const currentYear = dayjs().year()
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState<MetaData>({ departments: [] })
  const [filters, setFilters] = useState({ year: String(currentYear), deptId: '' })

  const isVpOrAdmin = session && ['vp', 'sysadmin'].includes(session.role)

  const loadReport = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ year: filters.year })
    if (filters.deptId) params.set('deptId', filters.deptId)
    const res = await api.get<ReportData>(`/api/reports?${params.toString()}`)
    if (res.success && res.data) setData(res.data)
    setLoading(false)
  }, [filters])

  useEffect(() => {
    api.get<MetaData>('/api/meta').then((res) => {
      if (res.success && res.data) setMeta(res.data)
    })
  }, [])

  useEffect(() => { loadReport() }, [loadReport])

  const columns = [
    { title: '人員', dataIndex: 'name', key: 'name' },
    { title: '已決件數', dataIndex: 'caseCount', key: 'caseCount', align: 'right' as const },
    {
      title: '公證費合計',
      dataIndex: 'totalFee',
      key: 'totalFee',
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 16 }}>員工績效統計</Title>

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
            <Button type="primary" onClick={loadReport} style={{ background: '#1B4F8C' }}>查詢</Button>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title="月度已決案件" bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data?.monthlyStats ?? []} margin={{ top: 8, right: 8, left: -20, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => [v, '案件數']} />
                <Bar dataKey="count" name="件數" radius={[3, 3, 0, 0]}>
                  {(data?.monthlyStats ?? []).map((_, i) => (
                    <Cell key={i} fill="#1B4F8C" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="員工績效" bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <Table
              dataSource={data?.employeePerformance ?? []}
              columns={columns}
              rowKey="id"
              loading={loading}
              size="small"
              pagination={false}
              scroll={{ y: 220 }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
