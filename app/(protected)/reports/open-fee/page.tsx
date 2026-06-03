'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Card, Table, Typography, Spin, Select, Row, Col, Button,
} from 'antd'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'

const { Title } = Typography
const { Option } = Select

interface OpenFeeItem {
  employeeId: number
  employeeName: string
  openCaseCount: number
  estimatedFeeTotal: number
}

interface MetaData {
  departments: { id: number; name: string }[]
}

export default function OpenFeeReportPage() {
  const { session } = useAuth()
  const [items, setItems] = useState<OpenFeeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState<MetaData>({ departments: [] })
  const [deptId, setDeptId] = useState('')

  const isVpOrAdmin = session && ['vp', 'sysadmin'].includes(session.role)

  const loadData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ status: '未決' })
    if (deptId) params.set('deptId', deptId)
    // Fetch all open cases and aggregate by employee
    const res = await api.get<{
      id: number;
      estimatedFee: number | null;
      handlers: { id: number; name: string }[];
    }[]>(`/api/cases?${params.toString()}&pageSize=500`)

    if (res.success && res.data) {
      const empMap: Record<number, OpenFeeItem> = {}
      for (const c of res.data) {
        for (const h of c.handlers) {
          if (!empMap[h.id]) {
            empMap[h.id] = { employeeId: h.id, employeeName: h.name, openCaseCount: 0, estimatedFeeTotal: 0 }
          }
          empMap[h.id].openCaseCount += 1
          empMap[h.id].estimatedFeeTotal += c.estimatedFee ?? 0
        }
      }
      setItems(Object.values(empMap).sort((a, b) => b.estimatedFeeTotal - a.estimatedFeeTotal))
    }
    setLoading(false)
  }, [deptId])

  useEffect(() => {
    api.get<MetaData>('/api/meta').then((res) => {
      if (res.success && res.data) setMeta(res.data)
    })
  }, [])

  useEffect(() => { loadData() }, [loadData])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin /></div>

  const columns = [
    { title: '人員', dataIndex: 'employeeName', key: 'name' },
    { title: '未決件數', dataIndex: 'openCaseCount', key: 'count', align: 'right' as const },
    {
      title: '預估公證費合計',
      dataIndex: 'estimatedFeeTotal',
      key: 'fee',
      align: 'right' as const,
      render: (v: number) => v ? v.toLocaleString() : '-',
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 16 }}>員工未決件數暨預估公證費</Title>
      {isVpOrAdmin && (
        <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}>
          <Row gutter={[12, 8]} align="middle">
            <Col xs={12} sm={6} md={4}>
              <Select
                placeholder="全部部門"
                style={{ width: '100%' }}
                value={deptId || undefined}
                onChange={(v) => setDeptId(v ?? '')}
                allowClear
              >
                {meta.departments.map((d) => <Option key={d.id} value={String(d.id)}>{d.name}</Option>)}
              </Select>
            </Col>
            <Col>
              <Button type="primary" onClick={loadData} style={{ background: '#1B4F8C' }}>查詢</Button>
            </Col>
          </Row>
        </Card>
      )}
      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Table
          dataSource={items}
          columns={columns}
          rowKey="employeeId"
          size="small"
          pagination={false}
          summary={(pageData) => {
            const totalCases = pageData.reduce((s, r) => s + r.openCaseCount, 0)
            const totalFee = pageData.reduce((s, r) => s + r.estimatedFeeTotal, 0)
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><strong>合計</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right"><strong>{totalCases}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right"><strong>{totalFee.toLocaleString()}</strong></Table.Summary.Cell>
              </Table.Summary.Row>
            )
          }}
        />
      </Card>
    </div>
  )
}
