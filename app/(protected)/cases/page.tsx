'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card, Table, Button, Input, Select, Space, Tag, Row, Col, Typography, Tooltip,
} from 'antd'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title } = Typography
const { Option } = Select

interface CaseItem {
  id: number
  caseNumber: string
  departmentName: string
  insuranceCompanyName: string
  insuredName: string
  insuranceType: string
  incidentDate: string
  commissionDate: string
  status: string
  currentStage: string
  estimatedAmount: number | null
  estimatedFee: number | null
  actualFee: number | null
  slaStatus: 'green' | 'yellow' | 'red'
  handlers: { id: number; name: string; role: string }[]
}

interface MetaData {
  insuranceCompanies: { id: number; name: string }[]
  departments: { id: number; name: string }[]
  insuranceTypes: { name: string }[]
}

const SLA_COLOR = { green: 'green', yellow: 'orange', red: 'red' } as const
const SLA_LABEL = { green: '正常', yellow: '警示', red: '逾期' } as const

export default function CasesPage() {
  const router = useRouter()
  const { session } = useAuth()
  const [cases, setCases] = useState<CaseItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState<MetaData>({ insuranceCompanies: [], departments: [], insuranceTypes: [] })

  const [filters, setFilters] = useState({
    q: '',
    status: '',
    icId: '',
    type: '',
    deptId: '',
    page: 1,
    pageSize: 20,
  })

  const canCreate = session && ['handler', 'admin_staff', 'sysadmin'].includes(session.role)
  const isVpOrAdmin = session && ['vp', 'sysadmin'].includes(session.role)

  const loadCases = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filters.q) params.set('q', filters.q)
    if (filters.status) params.set('status', filters.status)
    if (filters.icId) params.set('icId', filters.icId)
    if (filters.type) params.set('type', filters.type)
    if (filters.deptId) params.set('deptId', filters.deptId)
    params.set('page', String(filters.page))
    params.set('pageSize', String(filters.pageSize))
    const res = await api.get<CaseItem[]>(`/api/cases?${params.toString()}`)
    if (res.success && res.data) {
      setCases(res.data)
      setTotal((res as { total?: number }).total ?? res.data.length)
    }
    setLoading(false)
  }, [filters])

  useEffect(() => {
    api.get<MetaData>('/api/meta').then((res) => {
      if (res.success && res.data) setMeta(res.data)
    })
  }, [])

  useEffect(() => {
    loadCases()
  }, [loadCases])

  const columns = [
    {
      title: 'SLA',
      dataIndex: 'slaStatus',
      key: 'sla',
      width: 60,
      render: (v: 'green' | 'yellow' | 'red') => (
        <Tooltip title={SLA_LABEL[v]}>
          <Tag color={SLA_COLOR[v]} style={{ margin: 0 }}>{SLA_LABEL[v]}</Tag>
        </Tooltip>
      ),
    },
    {
      title: '案件編號',
      dataIndex: 'caseNumber',
      key: 'caseNumber',
      render: (v: string, r: CaseItem) => (
        <Button type="link" size="small" onClick={() => router.push(`/cases/${r.id}`)}>{v}</Button>
      ),
    },
    { title: '被保人', dataIndex: 'insuredName', key: 'insuredName' },
    {
      title: '狀態',
      dataIndex: 'status',
      key: 'status',
      render: (v: string) => (
        <Tag color={v === '已決' ? 'green' : v === '銷案' ? 'default' : 'blue'}>{v}</Tag>
      ),
    },
    { title: '目前階段', dataIndex: 'currentStage', key: 'currentStage' },
    { title: '保險公司', dataIndex: 'insuranceCompanyName', key: 'ic' },
    { title: '險種', dataIndex: 'insuranceType', key: 'type' },
    ...(isVpOrAdmin ? [{ title: '部門', dataIndex: 'departmentName', key: 'dept' }] : []),
    {
      title: '承辦人',
      key: 'handlers',
      render: (_: unknown, r: CaseItem) => r.handlers.map((h) => h.name).join('、'),
    },
    {
      title: '受任日',
      dataIndex: 'commissionDate',
      key: 'commissionDate',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD'),
    },
    {
      title: '估計損失',
      dataIndex: 'estimatedAmount',
      key: 'estimatedAmount',
      align: 'right' as const,
      render: (v: number | null) => v ? v.toLocaleString() : '-',
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>案件管理</Title>
        {canCreate && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => router.push('/cases/new')}
            style={{ background: '#1B4F8C' }}
          >
            新增案件
          </Button>
        )}
      </div>

      <Card
        bordered={false}
        style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}
        bodyStyle={{ paddingBottom: 8 }}
      >
        <Row gutter={[12, 8]}>
          <Col xs={24} sm={8} md={6}>
            <Input
              placeholder="搜尋案件號/被保人/保單號"
              prefix={<SearchOutlined />}
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value, page: 1 }))}
              allowClear
            />
          </Col>
          <Col xs={12} sm={4}>
            <Select
              placeholder="狀態"
              style={{ width: '100%' }}
              value={filters.status || undefined}
              onChange={(v) => setFilters((f) => ({ ...f, status: v ?? '', page: 1 }))}
              allowClear
            >
              <Option value="未決">未決</Option>
              <Option value="已決">已決</Option>
              <Option value="銷案">銷案</Option>
            </Select>
          </Col>
          <Col xs={12} sm={4}>
            <Select
              placeholder="保險公司"
              style={{ width: '100%' }}
              value={filters.icId || undefined}
              onChange={(v) => setFilters((f) => ({ ...f, icId: v ?? '', page: 1 }))}
              allowClear
              showSearch
              filterOption={(input, opt) => String(opt?.children ?? '').includes(input)}
            >
              {meta.insuranceCompanies.map((ic) => (
                <Option key={ic.id} value={String(ic.id)}>{ic.name}</Option>
              ))}
            </Select>
          </Col>
          <Col xs={12} sm={4}>
            <Select
              placeholder="險種"
              style={{ width: '100%' }}
              value={filters.type || undefined}
              onChange={(v) => setFilters((f) => ({ ...f, type: v ?? '', page: 1 }))}
              allowClear
            >
              {meta.insuranceTypes.map((t) => (
                <Option key={t.name} value={t.name}>{t.name}</Option>
              ))}
            </Select>
          </Col>
          {isVpOrAdmin && (
            <Col xs={12} sm={4}>
              <Select
                placeholder="部門"
                style={{ width: '100%' }}
                value={filters.deptId || undefined}
                onChange={(v) => setFilters((f) => ({ ...f, deptId: v ?? '', page: 1 }))}
                allowClear
              >
                {meta.departments.map((d) => (
                  <Option key={d.id} value={String(d.id)}>{d.name}</Option>
                ))}
              </Select>
            </Col>
          )}
          <Col xs={12} sm={4}>
            <Space>
              <Button onClick={loadCases} type="primary" style={{ background: '#1B4F8C' }}>查詢</Button>
              <Button onClick={() => setFilters({ q: '', status: '', icId: '', type: '', deptId: '', page: 1, pageSize: 20 })}>清除</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Table
          dataSource={cases}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="small"
          scroll={{ x: 1200 }}
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 筆`,
            onChange: (page, pageSize) => setFilters((f) => ({ ...f, page, pageSize })),
          }}
        />
      </Card>
    </div>
  )
}
