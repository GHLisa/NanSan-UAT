'use client'

import { useEffect, useState } from 'react'
import { Table, Button, Card, Typography, Tag, Space, Modal, Form, Input, Select, message, Tabs } from 'antd'
import { PlusOutlined, ImportOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import { canDispatch } from '@/lib/permissions'
import dayjs from 'dayjs'
import type { DispatchItem } from '@/types'

const { Title } = Typography

export default function DispatchListPage() {
  const { session } = useAuth()
  const [items, setItems] = useState<DispatchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('待取件')
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [depts, setDepts] = useState<{ id: number; name: string }[]>([])
  const [companies, setCompanies] = useState<{ id: number; name: string }[]>([])

  const fetchItems = async (status?: string) => {
    setLoading(true)
    const res = await api.get<DispatchItem[]>(`/api/dispatch${status ? `?status=${status}` : ''}`)
    if (res.success && res.data) setItems(res.data)
    setLoading(false)
  }

  useEffect(() => {
    fetchItems(activeTab)
    api.get<{ departments: { id: number; name: string }[]; insuranceCompanies: { id: number; name: string }[] }>('/api/meta').then((res) => {
      if (res.success && res.data) {
        setDepts(res.data.departments)
        setCompanies(res.data.insuranceCompanies)
      }
    })
  }, [activeTab])

  async function handlePickup(id: number) {
    const res = await api.patch(`/api/dispatch/${id}`, { action: 'pickup' })
    if (res.success) {
      message.success('已取件')
      fetchItems(activeTab)
    } else {
      message.error(res.error ?? '操作失敗')
    }
  }

  async function handleCreate(values: Record<string, unknown>) {
    const res = await api.post('/api/dispatch', {
      ...values,
      insuranceCompanyId: Number(values.insuranceCompanyId),
      assignedDepartmentId: Number(values.assignedDepartmentId),
    })
    if (res.success) {
      message.success('派案成功')
      setModalOpen(false)
      form.resetFields()
      fetchItems(activeTab)
    } else {
      message.error(res.error ?? '建立失敗')
    }
  }

  const columns = [
    {
      title: '來源', dataIndex: 'sourceType', key: 'sourceType',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    { title: '來源說明', dataIndex: 'sourceReference', key: 'sourceReference', ellipsis: true },
    { title: '保險公司', dataIndex: 'insuranceCompanyName', key: 'insuranceCompanyName' },
    { title: '指派部門', dataIndex: 'assignedDepartmentName', key: 'assignedDepartmentName' },
    {
      title: '狀態', dataIndex: 'status', key: 'status',
      render: (v: string) => <Tag color={v === '待取件' ? 'blue' : v === '已取件' ? 'orange' : 'green'}>{v}</Tag>,
    },
    {
      title: '建立時間', dataIndex: 'createdAt', key: 'createdAt',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '操作', key: 'action',
      render: (_: unknown, record: DispatchItem) => (
        record.status === '待取件' ? (
          <Button type="primary" size="small" icon={<ImportOutlined />} onClick={() => handlePickup(record.id)}>
            取件
          </Button>
        ) : (
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>
            {record.pickerName ? `已由 ${record.pickerName} 取件` : '—'}
          </span>
        )
      ),
    },
  ]

  const tabItems = [
    { key: '待取件', label: `待取件 (${items.filter((i) => i.status === '待取件').length})` },
    { key: '已取件', label: '已取件' },
    { key: '已成案', label: '已成案' },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>派案池</Title>
        {session && canDispatch(session.role) && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            新增派案
          </Button>
        )}
      </div>

      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} style={{ marginBottom: 16 }} />
        <Table
          columns={columns}
          dataSource={items}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          size="middle"
        />
      </Card>

      <Modal
        title="新增派案"
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields() }}
        footer={null}
        width={600}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="sourceType" label="來源類型" rules={[{ required: true }]} initialValue="Email">
            <Select options={[{ value: 'Email' }, { value: 'NAS路徑' }, { value: '其他' }]} />
          </Form.Item>
          <Form.Item name="sourceReference" label="來源說明" rules={[{ required: true }]}>
            <Input.TextArea rows={2} placeholder="郵件主旨或 NAS 路徑" />
          </Form.Item>
          <Form.Item name="insuranceCompanyId" label="保險公司" rules={[{ required: true }]}>
            <Select
              showSearch optionFilterProp="label"
              options={companies.map((c) => ({ value: c.id, label: c.name }))}
              placeholder="選擇保險公司"
            />
          </Form.Item>
          <Form.Item name="assignedDepartmentId" label="指派部門" rules={[{ required: true }]}>
            <Select
              options={depts.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="選擇部門"
            />
          </Form.Item>
          <Form.Item name="assignmentNotes" label="備註">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setModalOpen(false)}>取消</Button>
            <Button type="primary" htmlType="submit">送出</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}
