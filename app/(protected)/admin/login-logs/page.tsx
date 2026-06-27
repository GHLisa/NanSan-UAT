'use client'

import { useEffect, useState, useCallback } from 'react'
import { Table, Card, Row, Col, Typography, Tag, Space, Input, Select, Button, Tooltip } from 'antd'
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '@/lib/api'

const { Title, Text } = Typography

const STATUS_LABEL: Record<string, string> = { success: '成功', fail: '失敗', locked: '鎖定中' }
const STATUS_COLOR: Record<string, string> = { success: 'green', fail: 'red', locked: 'orange' }

interface LoginLogItem {
  id: number
  createdAt: string
  employeeId: number | null
  username: string
  name: string | null
  status: string
  reason: string | null
  ip: string | null
  userAgent: string | null
}

export default function LoginLogsPage() {
  const [rows, setRows] = useState<LoginLogItem[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (status) params.set('status', status)
    const res = await api.get<LoginLogItem[]>(`/api/admin/login-logs${params.toString() ? `?${params}` : ''}`)
    if (res.success && res.data) setRows(res.data)
    setLoading(false)
  }, [q, status])

  useEffect(() => { load() }, [load])

  const columns = [
    {
      title: '時間', dataIndex: 'createdAt', width: 160,
      render: (v: string) => dayjs(v).format('YYYY/MM/DD HH:mm:ss'),
    },
    { title: '帳號', dataIndex: 'username', width: 150 },
    {
      title: '姓名', dataIndex: 'name', width: 120,
      render: (v: string | null) => v || '—',
    },
    {
      title: '狀態', dataIndex: 'status', width: 90,
      render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'}>{STATUS_LABEL[v] ?? v}</Tag>,
    },
    {
      title: '原因', dataIndex: 'reason', ellipsis: true,
      render: (v: string | null) => v ? <Tooltip title={v}><span>{v}</span></Tooltip> : '—',
    },
    {
      title: '來源 IP', dataIndex: 'ip', width: 140,
      render: (v: string | null) => v || '—',
    },
    {
      title: '瀏覽器', dataIndex: 'userAgent', ellipsis: true,
      render: (v: string | null) => v
        ? <Tooltip title={v}><Text type="secondary" style={{ fontSize: 12 }}>{v}</Text></Tooltip>
        : '—',
    },
  ]

  return (
    <div className="page-container" style={{ padding: 24 }}>
      <Title level={4} style={{ margin: '0 0 16px' }}>登入紀錄</Title>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} sm={12} md={10}>
            <Input
              allowClear prefix={<SearchOutlined />}
              placeholder="搜尋帳號 / 姓名 / IP"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onPressEnter={load}
            />
          </Col>
          <Col xs={16} sm={8} md={6}>
            <Select
              style={{ width: '100%' }}
              value={status}
              onChange={setStatus}
              options={[
                { value: '', label: '全部狀態' },
                { value: 'success', label: '成功' },
                { value: 'fail', label: '失敗' },
                { value: 'locked', label: '鎖定中' },
              ]}
            />
          </Col>
          <Col xs={8} sm={4} md={4}>
            <Button icon={<ReloadOutlined />} onClick={load}>查詢</Button>
          </Col>
        </Row>
      </Card>

      <Card size="small">
        <Space style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>共 {rows.length} 筆（最多顯示最新 500 筆）</Text>
        </Space>
        <Table
          dataSource={rows}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 1000 }}
        />
      </Card>
    </div>
  )
}
