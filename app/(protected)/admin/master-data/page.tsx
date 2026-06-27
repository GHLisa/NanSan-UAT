'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Card, Table, Tabs, Button, Modal, Form, Input, Switch, Select,
  Typography, message, Tag, Tooltip,
} from 'antd'
import { PlusOutlined, EditOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'

const { Title, Text } = Typography

const FEE_CATEGORIES = ['工程險', '責任險', '火險', '水險']
const FEE_CATEGORY_COLOR: Record<string, string> = {
  '工程險': 'blue', '責任險': 'orange', '火險': 'volcano', '水險': 'cyan',
}

// ── 保險公司 Tab ──────────────────────────────────────────────────────────
function InsuranceCompanyTab() {
  type IC = { id: number; code: string; name: string; branch: string | null }
  const [items, setItems] = useState<IC[]>([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [editTarget, setEditTarget] = useState<IC | null>(null)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<IC[]>('/api/admin/master-data/insurance-companies')
    if (res.success && res.data) setItems(res.data)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function handleSubmit(values: { code: string; name: string; branch?: string }) {
    const res = editTarget
      ? await api.patch(`/api/admin/master-data/insurance-companies?id=${editTarget.id}`, { name: values.name, branch: values.branch ?? '' })
      : await api.post('/api/admin/master-data/insurance-companies', { code: values.code.toUpperCase(), name: values.name, branch: values.branch ?? '' })
    if (res.success) { message.success(editTarget ? '已更新' : '已新增'); setModal(false); load() }
    else message.error(res.error ?? '操作失敗')
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50 },
    { title: '代碼', dataIndex: 'code', key: 'code', width: 70 },
    { title: '名稱', dataIndex: 'name', key: 'name' },
    { title: '分行', dataIndex: 'branch', key: 'branch' },
    {
      title: '操作', key: 'action', width: 70,
      render: (_: unknown, r: IC) => (
        <Button size="small" type="link" icon={<EditOutlined />}
          onClick={() => { setEditTarget(r); form.setFieldsValue({ code: r.code, name: r.name, branch: r.branch ?? '' }); setModal(true) }}>
          編輯
        </Button>
      ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button size="small" type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C' }}
          onClick={() => { setEditTarget(null); form.resetFields(); setModal(true) }}>新增</Button>
      </div>
      <Table dataSource={items} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} />
      <Modal
        title={editTarget ? '編輯保險公司' : '新增保險公司'}
        open={modal}
        onCancel={() => { setModal(false); form.resetFields(); setEditTarget(null) }}
        onOk={() => form.submit()}
        okText={editTarget ? '儲存' : '新增'}
        okButtonProps={{ style: { background: '#1B4F8C' } }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 16 }}>
          <Form.Item name="code" label="代碼" rules={[{ required: true, message: '必填' }]}>
            <Input disabled={!!editTarget} style={{ width: 100 }} maxLength={4} />
          </Form.Item>
          <Form.Item name="name" label="名稱" rules={[{ required: true, message: '必填' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="branch" label="分行（選填）">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ── 保代公司 Tab ──────────────────────────────────────────────────────────
function BrokerCompanyTab() {
  type BC = { id: number; name: string; isActive: boolean }
  const [items, setItems] = useState<BC[]>([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [editTarget, setEditTarget] = useState<BC | null>(null)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<BC[]>('/api/admin/master-data/broker-companies')
    if (res.success && res.data) setItems(res.data)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function handleSubmit(values: { name: string; isActive: boolean }) {
    const res = editTarget
      ? await api.patch(`/api/admin/master-data/broker-companies?id=${editTarget.id}`, values)
      : await api.post('/api/admin/master-data/broker-companies', values)
    if (res.success) { message.success(editTarget ? '已更新' : '已新增'); setModal(false); load() }
    else message.error(res.error ?? '操作失敗')
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50 },
    { title: '名稱', dataIndex: 'name', key: 'name' },
    { title: '狀態', dataIndex: 'isActive', key: 'isActive', width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '啟用' : '停用'}</Tag> },
    {
      title: '操作', key: 'action', width: 70,
      render: (_: unknown, r: BC) => (
        <Button size="small" type="link" icon={<EditOutlined />}
          onClick={() => { setEditTarget(r); form.setFieldsValue({ name: r.name, isActive: r.isActive }); setModal(true) }}>
          編輯
        </Button>
      ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button size="small" type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C' }}
          onClick={() => { setEditTarget(null); form.resetFields(); setModal(true) }}>新增</Button>
      </div>
      <Table dataSource={items} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} />
      <Modal
        title={editTarget ? '編輯保代公司' : '新增保代公司'}
        open={modal}
        onCancel={() => { setModal(false); form.resetFields(); setEditTarget(null) }}
        onOk={() => form.submit()}
        okText={editTarget ? '儲存' : '新增'}
        okButtonProps={{ style: { background: '#1B4F8C' } }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 16 }}>
          <Form.Item name="name" label="名稱" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item>
          <Form.Item name="isActive" label="狀態" valuePropName="checked" initialValue={true}>
            <Switch checkedChildren="啟用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ── 部門 Tab ──────────────────────────────────────────────────────────────
function DepartmentTab() {
  type Dept = { id: number; code: string; name: string; regionId: number; regionName: string }
  const [items, setItems] = useState<Dept[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<Dept[]>('/api/admin/master-data/departments')
    if (res.success && res.data) setItems(res.data)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50 },
    { title: '代碼', dataIndex: 'code', key: 'code', width: 70 },
    { title: '名稱', dataIndex: 'name', key: 'name' },
    { title: '區域', dataIndex: 'regionName', key: 'regionName', width: 80 },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button size="small" type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C' }}
          onClick={() => message.info('部門新增功能（示意）')}>新增</Button>
      </div>
      <Table dataSource={items} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} />
    </>
  )
}

// ── 出險/查勘地點 Tab ──────────────────────────────────────────────────────
function IncidentLocationTab() {
  type Loc = { id: number; name: string; isActive: boolean }
  const [items, setItems] = useState<Loc[]>([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Loc | null>(null)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<Loc[]>('/api/admin/master-data/incident-locations')
    if (res.success && res.data) setItems(res.data)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function handleSubmit(values: { name: string; isActive: boolean }) {
    const res = editTarget
      ? await api.patch(`/api/admin/master-data/incident-locations?id=${editTarget.id}`, values)
      : await api.post('/api/admin/master-data/incident-locations', values)
    if (res.success) { message.success(editTarget ? '已更新' : '已新增'); setModal(false); load() }
    else message.error(res.error ?? '操作失敗')
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50 },
    { title: '地點名稱', dataIndex: 'name', key: 'name' },
    { title: '狀態', dataIndex: 'isActive', key: 'isActive', width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '啟用' : '停用'}</Tag> },
    {
      title: '操作', key: 'action', width: 70,
      render: (_: unknown, r: Loc) => (
        <Button size="small" type="link" icon={<EditOutlined />}
          onClick={() => { setEditTarget(r); form.setFieldsValue({ name: r.name, isActive: r.isActive }); setModal(true) }}>
          編輯
        </Button>
      ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button size="small" type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C' }}
          onClick={() => { setEditTarget(null); form.resetFields(); setModal(true) }}>新增</Button>
      </div>
      <Table dataSource={items} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} scroll={{ y: 400 }} />
      <Modal
        title={editTarget ? '編輯地點' : '新增地點'}
        open={modal}
        onCancel={() => { setModal(false); form.resetFields(); setEditTarget(null) }}
        onOk={() => form.submit()}
        okText={editTarget ? '儲存' : '新增'}
        okButtonProps={{ style: { background: '#1B4F8C' } }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 16 }}>
          <Form.Item name="name" label="地點名稱" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item>
          <Form.Item name="isActive" label="狀態" valuePropName="checked" initialValue={true}>
            <Switch checkedChildren="啟用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ── 險種 Tab ──────────────────────────────────────────────────────────────
function InsuranceTypeTab() {
  type IT = { id: number; name: string; feeCategory: string; isActive: boolean }
  const [items, setItems] = useState<IT[]>([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [editTarget, setEditTarget] = useState<IT | null>(null)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<IT[]>('/api/admin/master-data/insurance-types')
    if (res.success && res.data) setItems(res.data)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function handleSubmit(values: { name: string; feeCategory: string; isActive: boolean }) {
    if (!editTarget) {
      const isDupe = items.some(t => t.name === values.name)
      if (isDupe) { message.error('險種名稱已存在'); return }
    }
    const res = editTarget
      ? await api.patch(`/api/admin/master-data/insurance-types?id=${editTarget.id}`, { feeCategory: values.feeCategory, isActive: values.isActive })
      : await api.post('/api/admin/master-data/insurance-types', values)
    if (res.success) { message.success(editTarget ? '已更新' : '已新增'); setModal(false); load() }
    else message.error(res.error ?? '操作失敗')
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50 },
    { title: '險種名稱', dataIndex: 'name', key: 'name', width: 180 },
    {
      title: (
        <span>
          費率表類別
          <Tooltip title="案件計算公證費時，依此欄位選用對應的費率表">
            <InfoCircleOutlined style={{ marginLeft: 4, color: '#aaa', fontSize: 12 }} />
          </Tooltip>
        </span>
      ),
      dataIndex: 'feeCategory', key: 'feeCategory', width: 130,
      render: (v: string) => <Tag color={FEE_CATEGORY_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    { title: '狀態', dataIndex: 'isActive', key: 'isActive', width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '啟用' : '停用'}</Tag> },
    {
      title: '操作', key: 'action', width: 70,
      render: (_: unknown, r: IT) => (
        <Button size="small" type="link" icon={<EditOutlined />}
          onClick={() => { setEditTarget(r); form.setFieldsValue({ name: r.name, feeCategory: r.feeCategory, isActive: r.isActive }); setModal(true) }}>
          編輯
        </Button>
      ),
    },
  ]

  return (
    <>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        設定各險種對應的費率表類別，系統於公證費試算時依此欄位選用對應費率。
        停用的險種不會出現在案件表單的「險種」下拉選單中。
      </Text>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button size="small" type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C' }}
          onClick={() => { setEditTarget(null); form.resetFields(); setModal(true) }}>新增</Button>
      </div>
      <Table dataSource={items} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} />
      <Modal
        title={editTarget ? '編輯險種' : '新增險種'}
        open={modal}
        onCancel={() => { setModal(false); form.resetFields(); setEditTarget(null) }}
        onOk={() => form.submit()}
        okText={editTarget ? '儲存' : '新增'}
        okButtonProps={{ style: { background: '#1B4F8C' } }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 16 }}>
          <Form.Item name="name" label="險種名稱" rules={[{ required: true, message: '必填' }]}>
            <Input disabled={!!editTarget} />
          </Form.Item>
          <Form.Item name="feeCategory" label="費率表類別" rules={[{ required: true, message: '必選' }]}>
            <Select options={FEE_CATEGORIES.map(c => ({ value: c, label: c }))} placeholder="請選擇" />
          </Form.Item>
          <Form.Item name="isActive" label="狀態" valuePropName="checked" initialValue={true}>
            <Switch checkedChildren="啟用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ── 區域 Tab ──────────────────────────────────────────────────────────────
function RegionTab() {
  type Region = { id: number; code: string; name: string }
  const [items, setItems] = useState<Region[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<Region[]>('/api/admin/master-data/regions')
    if (res.success && res.data) setItems(res.data)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <Table
      dataSource={items} loading={loading}
      columns={[
        { title: 'ID', dataIndex: 'id', key: 'id', width: 50 },
        { title: '代碼', dataIndex: 'code', key: 'code', width: 70 },
        { title: '名稱', dataIndex: 'name', key: 'name' },
      ]}
      rowKey="id" size="small" pagination={false}
    />
  )
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function MasterDataPage() {
  const tabItems = [
    { key: '1', label: '保險公司',      children: <InsuranceCompanyTab /> },
    { key: '2', label: '保代公司',      children: <BrokerCompanyTab /> },
    { key: '3', label: '部門',          children: <DepartmentTab /> },
    { key: '5', label: '出險/查勘地點', children: <IncidentLocationTab /> },
    { key: '6', label: '險種',          children: <InsuranceTypeTab /> },
    { key: '4', label: '區域',          children: <RegionTab /> },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 16 }}>基礎資料管理</Title>
      <Card size="small">
        <Tabs items={tabItems} />
      </Card>
    </div>
  )
}
