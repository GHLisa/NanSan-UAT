'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Card, Table, Tabs, Button, Modal, Form, Input, Switch, Select,
  Typography, message, Tag, Tooltip, Popconfirm, Space,
} from 'antd'
import { PlusOutlined, EditOutlined, InfoCircleOutlined, DeleteOutlined } from '@ant-design/icons'
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
  type Dept = { id: number; code: string; caseNoCode: string | null; name: string; regionId: number; regionName: string }
  const [items, setItems] = useState<Dept[]>([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Dept | null>(null)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<Dept[]>('/api/admin/master-data/departments')
    if (res.success && res.data) setItems(res.data)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function handleSubmit(values: { caseNoCode?: string }) {
    const res = await api.patch(
      `/api/admin/master-data/departments?id=${editTarget!.id}`,
      { caseNoCode: values.caseNoCode?.trim() || null },
    )
    if (res.success) { message.success('已更新'); setModal(false); load() }
    else message.error(res.error ?? '操作失敗')
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50 },
    { title: '代碼', dataIndex: 'code', key: 'code', width: 70 },
    { title: '名稱', dataIndex: 'name', key: 'name' },
    { title: '區域', dataIndex: 'regionName', key: 'regionName', width: 80 },
    {
      title: (
        <span>
          公證編號代號
          <Tooltip title="產生公證編號時使用的部門前綴；未設定則沿用左側「代碼」">
            <InfoCircleOutlined style={{ marginLeft: 4, color: '#aaa', fontSize: 12 }} />
          </Tooltip>
        </span>
      ),
      key: 'caseNoCode', width: 140,
      render: (_: unknown, r: Dept) =>
        r.caseNoCode ? <Tag color="blue">{r.caseNoCode}</Tag> : <Text type="secondary">（同代碼 {r.code}）</Text>,
    },
    {
      title: '操作', key: 'action', width: 70,
      render: (_: unknown, r: Dept) => (
        <Button size="small" type="link" icon={<EditOutlined />}
          onClick={() => { setEditTarget(r); form.setFieldsValue({ caseNoCode: r.caseNoCode ?? '' }); setModal(true) }}>
          編輯
        </Button>
      ),
    },
  ]

  return (
    <>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        「公證編號代號」為產生公證編號時的部門前綴，可獨立於部門代碼調整；未設定時沿用部門代碼。
        部門代碼／名稱／區域涉及審核分類與權限，不開放於此編輯。
      </Text>
      <Table dataSource={items} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} />
      <Modal
        title={`編輯公證編號代號 — ${editTarget?.name ?? ''}`}
        open={modal}
        onCancel={() => { setModal(false); form.resetFields(); setEditTarget(null) }}
        onOk={() => form.submit()}
        okText="儲存"
        okButtonProps={{ style: { background: '#1B4F8C' } }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 16 }}>
          <Form.Item label="部門">
            <Input value={`${editTarget?.name ?? ''}（代碼 ${editTarget?.code ?? ''}）`} disabled />
          </Form.Item>
          <Form.Item
            name="caseNoCode"
            label="公證編號代號"
            extra="留空則沿用部門代碼。變更後僅影響該部門「之後新建」案件的公證編號前綴，既有案件不變。"
          >
            <Input placeholder={editTarget?.code ?? ''} />
          </Form.Item>
        </Form>
      </Modal>
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
    // [2026/07/01] - Lisa - 名稱重複檢查（新增或改名皆須，排除自身）
    const isDupe = items.some(t => t.name === values.name && t.id !== editTarget?.id)
    if (isDupe) { message.error('險種名稱已存在'); return }

    if (!editTarget) {
      const res = await api.post('/api/admin/master-data/insurance-types', values)
      if (res.success) { message.success('已新增'); setModal(false); load() }
      else message.error(res.error ?? '操作失敗')
      return
    }
    // [2026/07/01] - Lisa - 開放編輯險種名稱：改名時若已有案件使用，後端回 409 提示，確認後同步更新既有案件
    await doUpdate(values, false)
  }

  async function doUpdate(values: { name: string; feeCategory: string; isActive: boolean }, confirmRename: boolean) {
    const res = await api.patch(
      `/api/admin/master-data/insurance-types?id=${editTarget!.id}`,
      { name: values.name, feeCategory: values.feeCategory, isActive: values.isActive, confirmRename },
    )
    if (res.success) { message.success('已更新'); setModal(false); load(); return }
    if ((res as { code?: string }).code === 'RENAME_AFFECTS_CASES') {
      Modal.confirm({
        title: '此險種已被案件使用',
        content: res.error ?? '改名將同步更新既有案件，確定要更新嗎？',
        okText: '確認更新',
        cancelText: '取消',
        okButtonProps: { style: { background: '#1B4F8C' } },
        onOk: () => doUpdate(values, true),
      })
      return
    }
    message.error(res.error ?? '操作失敗')
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
            <Input />
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
  type Region = { id: number; code: string; name: string; caseNoCode: string | null }
  const [items, setItems] = useState<Region[]>([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Region | null>(null)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<Region[]>('/api/admin/master-data/regions')
    if (res.success && res.data) setItems(res.data)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function handleSubmit(values: { caseNoCode?: string }) {
    const res = await api.patch(
      `/api/admin/master-data/regions?id=${editTarget!.id}`,
      { caseNoCode: (values.caseNoCode ?? '').trim() },
    )
    if (res.success) { message.success('已更新'); setModal(false); load() }
    else message.error(res.error ?? '操作失敗')
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50 },
    { title: '代碼', dataIndex: 'code', key: 'code', width: 70 },
    { title: '名稱', dataIndex: 'name', key: 'name' },
    {
      title: (
        <span>
          公證編號代號
          <Tooltip title="產生公證編號時的區域代號段（台北空白、台中 T、高雄 K）">
            <InfoCircleOutlined style={{ marginLeft: 4, color: '#aaa', fontSize: 12 }} />
          </Tooltip>
        </span>
      ),
      key: 'caseNoCode', width: 140,
      render: (_: unknown, r: Region) =>
        r.caseNoCode ? <Tag color="blue">{r.caseNoCode}</Tag> : <Text type="secondary">（空白）</Text>,
    },
    {
      title: '操作', key: 'action', width: 70,
      render: (_: unknown, r: Region) => (
        <Button size="small" type="link" icon={<EditOutlined />}
          onClick={() => { setEditTarget(r); form.setFieldsValue({ caseNoCode: r.caseNoCode ?? '' }); setModal(true) }}>
          編輯
        </Button>
      ),
    },
  ]

  return (
    <>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        「公證編號代號」為產生公證編號時的區域代號段（台北留空白、台中 T、高雄 K）。留空即代表該區域無區域代號。
      </Text>
      <Table dataSource={items} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} />
      <Modal
        title={`編輯公證編號代號 — ${editTarget?.name ?? ''}`}
        open={modal}
        onCancel={() => { setModal(false); form.resetFields(); setEditTarget(null) }}
        onOk={() => form.submit()}
        okText="儲存"
        okButtonProps={{ style: { background: '#1B4F8C' } }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 16 }}>
          <Form.Item label="區域">
            <Input value={`${editTarget?.name ?? ''}（代碼 ${editTarget?.code ?? ''}）`} disabled />
          </Form.Item>
          <Form.Item
            name="caseNoCode"
            label="公證編號代號"
            extra="留空代表無區域代號（如台北）。變更後僅影響之後新建案件的公證編號。"
          >
            <Input placeholder="（留空）" maxLength={4} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

// ── 出險原因 Tab ──────────────────────────────────────────────────────────
function IncidentCauseTab() {
  type ICause = { id: number; name: string; isActive: boolean }
  const [items, setItems] = useState<ICause[]>([])
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(false)
  const [editTarget, setEditTarget] = useState<ICause | null>(null)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<ICause[]>('/api/admin/master-data/incident-causes')
    if (res.success && res.data) setItems(res.data)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function handleSubmit(values: { name: string; isActive: boolean }) {
    // 名稱重複檢查（新增或改名皆須，排除自身）
    const isDupe = items.some(t => t.name === values.name && t.id !== editTarget?.id)
    if (isDupe) { message.error('出險原因已存在'); return }

    if (!editTarget) {
      const res = await api.post('/api/admin/master-data/incident-causes', values)
      if (res.success) { message.success('已新增'); setModal(false); load() }
      else message.error(res.error ?? '操作失敗')
      return
    }
    // 改名時若已有案件使用，後端回 409 提示，確認後同步更新既有案件
    await doUpdate(values, false)
  }

  async function doUpdate(values: { name: string; isActive: boolean }, confirmRename: boolean) {
    const res = await api.patch(
      `/api/admin/master-data/incident-causes?id=${editTarget!.id}`,
      { name: values.name, isActive: values.isActive, confirmRename },
    )
    if (res.success) { message.success('已更新'); setModal(false); load(); return }
    if (res.code === 'RENAME_AFFECTS_CASES') {
      Modal.confirm({
        title: '此出險原因已被案件使用',
        content: res.error ?? '改名將同步更新既有案件，確定要更新嗎？',
        okText: '確認更新',
        cancelText: '取消',
        okButtonProps: { style: { background: '#1B4F8C' } },
        onOk: () => doUpdate(values, true),
      })
      return
    }
    message.error(res.error ?? '操作失敗')
  }

  async function handleDelete(r: ICause) {
    const res = await api.delete(`/api/admin/master-data/incident-causes?id=${r.id}`)
    if (res.success) { message.success('已刪除'); load() }
    else message.error(res.error ?? '刪除失敗')
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 50 },
    { title: '出險原因', dataIndex: 'name', key: 'name' },
    { title: '狀態', dataIndex: 'isActive', key: 'isActive', width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '啟用' : '停用'}</Tag> },
    {
      title: '操作', key: 'action', width: 140,
      render: (_: unknown, r: ICause) => (
        <Space size={0}>
          <Button size="small" type="link" icon={<EditOutlined />}
            onClick={() => { setEditTarget(r); form.setFieldsValue({ name: r.name, isActive: r.isActive }); setModal(true) }}>
            編輯
          </Button>
          <Popconfirm
            title="確定刪除此出險原因？"
            description="既有案件已填寫的值不受影響。"
            okText="刪除" cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(r)}
          >
            <Button size="small" type="link" danger icon={<DeleteOutlined />}>刪除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 10 }}>
        維護案件表單「出險原因」下拉選項。停用的原因不會出現在案件表單的下拉選單中。
      </Text>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <Button size="small" type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C' }}
          onClick={() => { setEditTarget(null); form.resetFields(); setModal(true) }}>新增</Button>
      </div>
      <Table dataSource={items} columns={columns} rowKey="id" loading={loading} size="small" pagination={false} />
      <Modal
        title={editTarget ? '編輯出險原因' : '新增出險原因'}
        open={modal}
        onCancel={() => { setModal(false); form.resetFields(); setEditTarget(null) }}
        onOk={() => form.submit()}
        okText={editTarget ? '儲存' : '新增'}
        okButtonProps={{ style: { background: '#1B4F8C' } }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 16 }}>
          <Form.Item name="name" label="出險原因" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item>
          <Form.Item name="isActive" label="狀態" valuePropName="checked" initialValue={true}>
            <Switch checkedChildren="啟用" unCheckedChildren="停用" />
          </Form.Item>
        </Form>
      </Modal>
    </>
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
    { key: '7', label: '出險原因',      children: <IncidentCauseTab /> },
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
