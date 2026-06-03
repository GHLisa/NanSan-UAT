'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Card, Table, Tabs, Button, Modal, Form, Input, Switch, Typography, Space, message, Tag,
} from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'

const { Title } = Typography

type MasterDataType = 'insurance-companies' | 'broker-companies' | 'insurance-types' | 'incident-locations' | 'departments' | 'regions'

interface MasterItem {
  id: number
  name: string
  code?: string
  isActive?: boolean
  feeCategory?: string
}

const TAB_CONFIG: { key: MasterDataType; label: string; hasCode: boolean; hasIsActive: boolean; hasFeeCategory: boolean }[] = [
  { key: 'insurance-companies', label: '保險公司', hasCode: true, hasIsActive: false, hasFeeCategory: false },
  { key: 'broker-companies', label: '保代公司', hasCode: false, hasIsActive: true, hasFeeCategory: false },
  { key: 'insurance-types', label: '險種', hasCode: false, hasIsActive: true, hasFeeCategory: true },
  { key: 'incident-locations', label: '出險地點', hasCode: false, hasIsActive: true, hasFeeCategory: false },
  { key: 'departments', label: '部門', hasCode: true, hasIsActive: false, hasFeeCategory: false },
  { key: 'regions', label: '地區', hasCode: true, hasIsActive: false, hasFeeCategory: false },
]

function MasterDataTab({ config }: { config: typeof TAB_CONFIG[0] }) {
  const [items, setItems] = useState<MasterItem[]>([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const loadItems = useCallback(async () => {
    setLoading(true)
    const res = await api.get<MasterItem[]>(`/api/admin/master-data/${config.key}`)
    if (res.success && res.data) setItems(res.data)
    setLoading(false)
  }, [config.key])

  useEffect(() => { loadItems() }, [loadItems])

  const handleToggleActive = async (id: number, isActive: boolean) => {
    const res = await api.patch(`/api/admin/master-data/${config.key}?id=${id}`, { isActive: !isActive })
    if (res.success) {
      message.success('已更新')
      loadItems()
    } else {
      message.error(res.error ?? '更新失敗')
    }
  }

  const handleSubmit = async (values: Record<string, unknown>) => {
    setSubmitting(true)
    const res = await api.post(`/api/admin/master-data/${config.key}`, values)
    setSubmitting(false)
    if (res.success) {
      message.success('新增成功')
      form.resetFields()
      setModal(false)
      loadItems()
    } else {
      message.error(res.error ?? '新增失敗')
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    ...(config.hasCode ? [{ title: '代碼', dataIndex: 'code', key: 'code' }] : []),
    { title: '名稱', dataIndex: 'name', key: 'name' },
    ...(config.hasFeeCategory ? [{ title: '費率分類', dataIndex: 'feeCategory', key: 'fee' }] : []),
    ...(config.hasIsActive ? [{
      title: '啟用',
      dataIndex: 'isActive',
      key: 'active',
      render: (v: boolean, r: MasterItem) => (
        <Tag
          color={v ? 'green' : 'default'}
          style={{ cursor: 'pointer' }}
          onClick={() => handleToggleActive(r.id, v)}
        >
          {v ? '啟用' : '停用'}
        </Tag>
      ),
    }] : []),
  ]

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setModal(true)} style={{ background: '#1B4F8C' }}>
          新增
        </Button>
      </div>
      <Table dataSource={items} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} />

      <Modal title={`新增${config.label}`} open={modal} onCancel={() => setModal(false)} footer={null} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          {config.hasCode && (
            <Form.Item label="代碼" name="code" rules={[{ required: true }]}><Input /></Form.Item>
          )}
          <Form.Item label="名稱" name="name" rules={[{ required: true }]}><Input /></Form.Item>
          {config.hasFeeCategory && (
            <Form.Item label="費率分類" name="feeCategory" rules={[{ required: true }]}><Input /></Form.Item>
          )}
          {config.hasIsActive && (
            <Form.Item label="啟用" name="isActive" valuePropName="checked" initialValue={true}>
              <Switch />
            </Form.Item>
          )}
          <Space>
            <Button type="primary" htmlType="submit" loading={submitting} style={{ background: '#1B4F8C' }}>新增</Button>
            <Button onClick={() => setModal(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}

export default function MasterDataPage() {
  const tabItems = TAB_CONFIG.map((config) => ({
    key: config.key,
    label: config.label,
    children: <MasterDataTab config={config} />,
  }))

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 16 }}>基礎資料管理</Title>
      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Tabs items={tabItems} />
      </Card>
    </div>
  )
}
