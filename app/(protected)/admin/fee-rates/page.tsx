'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Table, Card, Button, Typography, Modal, Form, Input, InputNumber,
  Select, Checkbox, Popconfirm, Space, Divider, Row, Col, Tabs, Tooltip, message,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'

const { Title, Text } = Typography

// ── Band column definitions ────────────────────────────────────────────────
const FR_BAND_COLS = [
  { maxAmount: 5_000_000,     header: '≤500萬' },
  { maxAmount: 10_000_000,    header: '500~1000萬' },
  { maxAmount: 20_000_000,    header: '1000~2000萬' },
  { maxAmount: 100_000_000,   header: '2000萬~1億' },
  { maxAmount: 500_000_000,   header: '1億~5億' },
  { maxAmount: 1_000_000_000, header: '5億~10億' },
  { maxAmount: 2_000_000_000, header: '10億~20億' },
]

const FIRE_BAND_COLS = [
  ...FR_BAND_COLS,
  { maxAmount: 9_999_999_999, header: '>20億' },
]

// ── Debit Note types ────────────────────────────────────────────────────────
const DEBIT_TYPES_ENG  = ['全額外加', '公證費外加', '稅內含']
const DEBIT_TYPES_FIRE = ['全額外加', '公證費外加稅', '公證費稅外加', '稅內含']

const DEBIT_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  '全額外加':    { bg: '#eff6ff', color: '#1a56db', border: '#bfdbfe' },
  '公證費外加':  { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  '公證費外加稅':{ bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  '公證費稅外加':{ bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  '稅內含':      { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
}

const INSURANCE_OPTIONS = ['工程險', '責任險', '雇主責任險', '工程附加雇主責任']

// ── Display helpers ────────────────────────────────────────────────────────
function DebitTag({ type }: { type: string }) {
  const c = DEBIT_COLORS[type] ?? DEBIT_COLORS['全額外加']
  return (
    <span style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}`, padding: '2px 6px', borderRadius: 4, fontSize: 12, whiteSpace: 'nowrap' }}>
      {type}
    </span>
  )
}

type Band = { maxAmount: number; rate: number | null }

function parseBands(json: string): Band[] {
  try { return JSON.parse(json) ?? [] } catch { return [] }
}

function getRateForBand(bands: Band[], colMaxAmount: number): Band | null {
  const sorted = [...bands].filter(b => b.maxAmount != null).sort((a, b) => a.maxAmount - b.maxAmount)
  return sorted.find(b => b.maxAmount >= colMaxAmount) ?? null
}

function FmtRate({ band }: { band: Band | null }) {
  if (!band) return <span style={{ color: '#e5e7eb' }}>—</span>
  if (band.rate === null) return <span style={{ color: '#bbb', fontSize: 12 }}>另議</span>
  return <strong style={{ color: '#1B4F8C' }}>{(band.rate * 100).toFixed(2)}%</strong>
}

function FmtFee({ val }: { val: number }) {
  if (val === 0) return <span style={{ color: '#d1d5db' }}>—</span>
  return <span>${val.toLocaleString()}</span>
}

// ── Band input component ───────────────────────────────────────────────────
function BandInputs({ prefix, cols }: { prefix: string; cols: typeof FR_BAND_COLS }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginBottom: 8 }}>
      {cols.map((band, i) => (
        <div key={i} style={{ width: 90 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>{band.header}</div>
          <Form.Item name={`${prefix}${i}_rate`} noStyle>
            <InputNumber size="small" min={0} max={100} step={0.001} style={{ width: 90 }} placeholder="%" />
          </Form.Item>
          <div>
            <Form.Item name={`${prefix}${i}_neg`} valuePropName="checked" noStyle>
              <Checkbox style={{ fontSize: 11, marginTop: 2 }}>另議</Checkbox>
            </Form.Item>
          </div>
        </div>
      ))}
    </div>
  )
}

function serializeBands(values: Record<string, unknown>, prefix: string, cols: typeof FR_BAND_COLS): string {
  const bands = cols.map((band, i) => {
    if (values[`${prefix}${i}_neg`]) return { maxAmount: band.maxAmount, rate: null }
    const r = values[`${prefix}${i}_rate`]
    if (r != null) return { maxAmount: band.maxAmount, rate: Number(r) / 100 }
    return null
  }).filter(Boolean)
  return JSON.stringify(bands)
}

function populateBandFields(form: ReturnType<typeof Form.useForm>[0], bands: Band[], prefix: string, cols: typeof FR_BAND_COLS) {
  const fieldValues: Record<string, unknown> = {}
  cols.forEach((col, i) => {
    const b = bands.find(x => x.maxAmount === col.maxAmount)
    if (b) {
      if (b.rate === null) fieldValues[`${prefix}${i}_neg`] = true
      else fieldValues[`${prefix}${i}_rate`] = parseFloat((b.rate * 100).toFixed(4))
    }
  })
  form.setFieldsValue(fieldValues)
}

// ── Types ──────────────────────────────────────────────────────────────────
interface EngRate {
  id: number; companyCode: string; companyName: string; insuranceType: string
  debitNoteType: string; minFee: number; rateBands: string; subRate: string | null
  mealExpense: number; accommodationExpense: number; photoFee: number; effectiveDate: string
}
interface FireRate {
  id: number; companyCode: string; companyName: string
  debitNoteType: string; minFee: number; rateBands: string; remarks: string | null; effectiveDate: string
}

// ── Engineering Modal ──────────────────────────────────────────────────────
function EngModal({ open, editing, onOk, onCancel }: { open: boolean; editing: EngRate | null; onOk: () => void; onCancel: () => void }) {
  const [form] = Form.useForm()

  useEffect(() => {
    if (open) {
      form.resetFields()
      if (editing) {
        const types = editing.insuranceType.split(',').filter(Boolean)
        form.setFieldsValue({
          companyCode: editing.companyCode, companyName: editing.companyName,
          insuranceType: types, debitNoteType: editing.debitNoteType,
          minFee: editing.minFee, effectiveDate: editing.effectiveDate,
          mealExpense: editing.mealExpense, accommodationExpense: editing.accommodationExpense, photoFee: editing.photoFee,
        })
        populateBandFields(form, parseBands(editing.rateBands), 'band_', FR_BAND_COLS)
      } else {
        form.setFieldsValue({ debitNoteType: '全額外加', minFee: 20000, mealExpense: 0, accommodationExpense: 0, photoFee: 0 })
      }
    }
  }, [open, editing, form])

  async function handleOk() {
    try {
      const values = await form.validateFields()
      const rateBands = serializeBands(values, 'band_', FR_BAND_COLS)
      const body = {
        type: '工程',
        companyCode: values.companyCode, companyName: values.companyName,
        insuranceType: (values.insuranceType as string[]).join(','),
        debitNoteType: values.debitNoteType, minFee: values.minFee,
        rateBands, effectiveDate: values.effectiveDate,
        mealExpense: values.mealExpense ?? 0,
        accommodationExpense: values.accommodationExpense ?? 0,
        photoFee: values.photoFee ?? 0,
      }
      const res = editing
        ? await api.put(`/api/admin/fee-rates?id=${editing.id}&type=工程`, body)
        : await api.post('/api/admin/fee-rates', body)
      if (res.success) { message.success(editing ? '已更新' : '已新增'); onOk() }
      else message.error(res.error ?? '操作失敗')
    } catch { /* validation failed */ }
  }

  return (
    <Modal open={open} title={editing ? `編輯：${editing.companyCode} ${editing.companyName}` : '新增保險公司'}
      onOk={handleOk} onCancel={onCancel} width={760} okText="儲存" cancelText="取消" destroyOnClose>
      <Form form={form} layout="vertical" size="small">
        <Row gutter={8}>
          <Col span={5}>
            <Form.Item name="companyCode" label="公司代號" rules={[{ required: true, message: '必填' }]}>
              <Input disabled={!!editing} />
            </Form.Item>
          </Col>
          <Col span={7}>
            <Form.Item name="companyName" label="公司名稱" rules={[{ required: true, message: '必填' }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="insuranceType" label="險種（可複選）" rules={[{ required: true, type: 'array', min: 1, message: '請至少選擇一種' }]}>
              <Select mode="multiple" options={INSURANCE_OPTIONS.map(t => ({ value: t, label: t }))} placeholder="選擇險種" allowClear />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={8}>
          <Col span={9}>
            <Form.Item name="debitNoteType" label="Debit Note 類型" rules={[{ required: true }]}>
              <Select options={DEBIT_TYPES_ENG.map(t => ({ value: t, label: t }))} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="minFee" label="最低費" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={7}>
            <Form.Item name="effectiveDate" label="生效日" rules={[{ required: true }]}>
              <Input placeholder="YYYY-MM-DD" />
            </Form.Item>
          </Col>
        </Row>

        <Divider style={{ fontSize: 12, margin: '4px 0 8px' }}>費率區間（輸入百分比，如 4.2；勾選「另議」表示 null）</Divider>
        <BandInputs prefix="band_" cols={FR_BAND_COLS} />

        <Divider style={{ fontSize: 12, margin: '4px 0 8px' }}>費用補貼</Divider>
        <Row gutter={8}>
          <Col span={8}>
            <Form.Item name="mealExpense" label="餐費">
              <InputNumber min={0} style={{ width: '100%' }} addonBefore="$" placeholder="0 = 不給" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="accommodationExpense" label="住宿費">
              <InputNumber min={0} style={{ width: '100%' }} addonBefore="$" placeholder="0 = 不給" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="photoFee" label="相片費">
              <InputNumber min={0} style={{ width: '100%' }} addonBefore="$" placeholder="0 = 不給" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  )
}

// ── Fire Modal ──────────────────────────────────────────────────────────────
function FireModal({ open, editing, onOk, onCancel }: { open: boolean; editing: FireRate | null; onOk: () => void; onCancel: () => void }) {
  const [form] = Form.useForm()

  useEffect(() => {
    if (open) {
      form.resetFields()
      if (editing) {
        form.setFieldsValue({
          companyCode: editing.companyCode, companyName: editing.companyName,
          debitNoteType: editing.debitNoteType, minFee: editing.minFee,
          effectiveDate: editing.effectiveDate, remarks: editing.remarks ?? '',
        })
        populateBandFields(form, parseBands(editing.rateBands), 'fband_', FIRE_BAND_COLS)
      } else {
        form.setFieldsValue({ debitNoteType: '全額外加', minFee: 20000 })
      }
    }
  }, [open, editing, form])

  async function handleOk() {
    try {
      const values = await form.validateFields()
      const rateBands = serializeBands(values, 'fband_', FIRE_BAND_COLS)
      const body = {
        type: '火險',
        companyCode: values.companyCode, companyName: values.companyName,
        debitNoteType: values.debitNoteType, minFee: values.minFee,
        rateBands, effectiveDate: values.effectiveDate, remarks: values.remarks,
      }
      const res = editing
        ? await api.put(`/api/admin/fee-rates?id=${editing.id}&type=火險`, body)
        : await api.post('/api/admin/fee-rates', body)
      if (res.success) { message.success(editing ? '已更新' : '已新增'); onOk() }
      else message.error(res.error ?? '操作失敗')
    } catch { /* validation failed */ }
  }

  return (
    <Modal open={open} title={editing ? `編輯：${editing.companyCode} ${editing.companyName}（火險）` : '新增保險公司（火險）'}
      onOk={handleOk} onCancel={onCancel} width={820} okText="儲存" cancelText="取消" destroyOnClose>
      <Form form={form} layout="vertical" size="small">
        <Row gutter={8}>
          <Col span={5}>
            <Form.Item name="companyCode" label="公司代號" rules={[{ required: true }]}>
              <Input disabled={!!editing} />
            </Form.Item>
          </Col>
          <Col span={7}>
            <Form.Item name="companyName" label="公司名稱" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={7}>
            <Form.Item name="debitNoteType" label="Debit Note 類型" rules={[{ required: true }]}>
              <Select options={DEBIT_TYPES_FIRE.map(t => ({ value: t, label: t }))} />
            </Form.Item>
          </Col>
          <Col span={5}>
            <Form.Item name="minFee" label="最低公證費" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={8}>
          <Col span={7}>
            <Form.Item name="effectiveDate" label="生效日" rules={[{ required: true }]}>
              <Input placeholder="YYYY-MM-DD" />
            </Form.Item>
          </Col>
        </Row>

        <Divider style={{ fontSize: 12, margin: '4px 0 8px' }}>
          費率區間（輸入百分比，如 3.00；勾選「另議」表示 null）
          <span style={{ marginLeft: 8, fontSize: 11, color: '#999', fontWeight: 400 }}>
            ＊一般公司填 ≤500萬 / 1000~2000萬 / 2000萬~1億 / 1億~5億 共 4 欄即可
          </span>
        </Divider>
        <BandInputs prefix="fband_" cols={FIRE_BAND_COLS} />

        <Form.Item name="remarks" label="備註（特殊條件）">
          <Input.TextArea rows={3} placeholder="如：住宅火險最低費特殊規定、水險適用規則等。多條用換行分隔。" />
        </Form.Item>
      </Form>
    </Modal>
  )
}

// ── Engineering Tab ────────────────────────────────────────────────────────
function EngineeringTab() {
  const [rates, setRates] = useState<EngRate[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<EngRate | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<EngRate[]>('/api/admin/fee-rates?type=工程')
    if (res.success && res.data) setRates(res.data)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function handleDelete(id: number) {
    const res = await api.delete(`/api/admin/fee-rates?id=${id}&type=工程`)
    if (res.success) { message.success('已刪除'); load() }
    else message.error(res.error ?? '刪除失敗')
  }

  const bandCols = FR_BAND_COLS.map(band => ({
    title: band.header, key: `b_${band.maxAmount}`, align: 'center' as const, width: 80,
    render: (_: unknown, r: EngRate) => {
      const bands = parseBands(r.rateBands)
      const b = getRateForBand(bands, band.maxAmount)
      return <FmtRate band={b} />
    },
  }))

  const columns = [
    {
      title: '公司', key: 'company', width: 90, fixed: 'left' as const,
      render: (_: unknown, r: EngRate) => (
        <div>
          <strong style={{ color: '#1B4F8C', fontSize: 15 }}>{r.companyCode}</strong>
          <br /><span style={{ fontSize: 12, color: '#999' }}>{r.companyName}</span>
        </div>
      ),
    },
    {
      title: '險種', dataIndex: 'insuranceType', key: 'type', width: 140,
      render: (v: string) => <span style={{ fontSize: 13 }}>{v.split(',').join('、')}</span>,
    },
    {
      title: 'DEBIT NOTE', key: 'debit', width: 100,
      render: (_: unknown, r: EngRate) => <DebitTag type={r.debitNoteType} />,
    },
    {
      title: '最低費', key: 'min', width: 80, align: 'right' as const,
      render: (_: unknown, r: EngRate) => `$${r.minFee.toLocaleString()}`,
    },
    {
      title: '費率', align: 'center' as const,
      children: bandCols,
    },
    {
      title: '餐費', key: 'meal', width: 80, align: 'center' as const,
      render: (_: unknown, r: EngRate) => <FmtFee val={r.mealExpense} />,
    },
    {
      title: '住宿', key: 'accom', width: 80, align: 'center' as const,
      render: (_: unknown, r: EngRate) => <FmtFee val={r.accommodationExpense} />,
    },
    {
      title: '相片費', key: 'photo', width: 65, align: 'center' as const,
      render: (_: unknown, r: EngRate) => <FmtFee val={r.photoFee} />,
    },
    {
      title: '生效日', key: 'date', width: 95, align: 'center' as const,
      render: (_: unknown, r: EngRate) => r.effectiveDate.slice(0, 10),
    },
    {
      title: '操作', key: 'action', width: 80, align: 'center' as const, fixed: 'right' as const,
      render: (_: unknown, r: EngRate) => (
        <Space size={2}>
          <Button type="link" size="small" icon={<EditOutlined />}
            onClick={() => { setEditing(r); setModalOpen(true) }} style={{ padding: '0 4px' }} />
          <Popconfirm title="確認刪除此保險公司？" okText="刪除" cancelText="取消" okType="danger" onConfirm={() => handleDelete(r.id)}>
            <Button type="link" size="small" icon={<DeleteOutlined />} danger style={{ padding: '0 4px' }} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C' }}
          onClick={() => { setEditing(null); setModalOpen(true) }}>
          新增保險公司
        </Button>
      </div>
      <Card size="small">
        <Table dataSource={rates} columns={columns} rowKey="id" loading={loading}
          size="small" scroll={{ x: 1400 }} pagination={false} bordered />
      </Card>
      <EngModal open={modalOpen} editing={editing}
        onOk={() => { setModalOpen(false); load() }}
        onCancel={() => setModalOpen(false)} />
    </>
  )
}

// ── Fire Tab ────────────────────────────────────────────────────────────────
function FireTab() {
  const [rates, setRates] = useState<FireRate[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<FireRate | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<FireRate[]>('/api/admin/fee-rates?type=火險')
    if (res.success && res.data) setRates(res.data)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function handleDelete(id: number) {
    const res = await api.delete(`/api/admin/fee-rates?id=${id}&type=火險`)
    if (res.success) { message.success('已刪除'); load() }
    else message.error(res.error ?? '刪除失敗')
  }

  const bandCols = FIRE_BAND_COLS.map(col => ({
    title: col.header, key: `fb_${col.maxAmount}`, align: 'center' as const, width: 82,
    render: (_: unknown, r: FireRate) => {
      const bands = parseBands(r.rateBands)
      const b = getRateForBand(bands, col.maxAmount)
      return <FmtRate band={b} />
    },
  }))

  const columns = [
    {
      title: '公司', key: 'company', width: 96, fixed: 'left' as const,
      render: (_: unknown, r: FireRate) => (
        <div>
          <strong style={{ color: '#1B4F8C', fontSize: 15 }}>{r.companyCode}</strong>
          <br /><span style={{ fontSize: 12, color: '#999' }}>{r.companyName}</span>
        </div>
      ),
    },
    {
      title: 'DEBIT NOTE', key: 'debit', width: 115,
      render: (_: unknown, r: FireRate) => <DebitTag type={r.debitNoteType} />,
    },
    {
      title: '最低公證費', key: 'min', width: 90, align: 'right' as const,
      render: (_: unknown, r: FireRate) => `$${r.minFee.toLocaleString()}`,
    },
    {
      title: '費率（公證費 / 理賠金額）', align: 'center' as const,
      children: bandCols,
    },
    {
      title: '備註', key: 'remarks', width: 56, align: 'center' as const,
      render: (_: unknown, r: FireRate) => r.remarks
        ? <Tooltip title={<span style={{ whiteSpace: 'pre-line', fontSize: 12 }}>{r.remarks}</span>} placement="topRight" overlayStyle={{ maxWidth: 340 }}>
            <InfoCircleOutlined style={{ color: '#d97706', cursor: 'pointer', fontSize: 15 }} />
          </Tooltip>
        : <span style={{ color: '#d1d5db' }}>—</span>,
    },
    {
      title: '生效日', key: 'date', width: 95, align: 'center' as const,
      render: (_: unknown, r: FireRate) => r.effectiveDate.slice(0, 10),
    },
    {
      title: '操作', key: 'action', width: 72, align: 'center' as const, fixed: 'right' as const,
      render: (_: unknown, r: FireRate) => (
        <Space size={2}>
          <Button type="link" size="small" icon={<EditOutlined />}
            onClick={() => { setEditing(r); setModalOpen(true) }} style={{ padding: '0 4px' }} />
          <Popconfirm title="確認刪除此保險公司火險費率？" okText="刪除" cancelText="取消" okType="danger" onConfirm={() => handleDelete(r.id)}>
            <Button type="link" size="small" icon={<DeleteOutlined />} danger style={{ padding: '0 4px' }} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Text type="secondary" style={{ fontSize: 11 }}>
          ＊大多數保險公司採 4 段費率（≤500萬 / 500~2000萬 / 2000萬~1億 / 1億~5億）；「500~1000萬」與「1000~2000萬」顯示相同費率為正常現象。
          有 <InfoCircleOutlined style={{ color: '#d97706' }} /> 圖示者表示有特殊計費備註，滑鼠移入可查看。
        </Text>
        <Button type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C', flexShrink: 0, marginLeft: 16 }}
          onClick={() => { setEditing(null); setModalOpen(true) }}>
          新增保險公司
        </Button>
      </div>
      <Card size="small">
        <Table dataSource={rates} columns={columns} rowKey="id" loading={loading}
          size="small" scroll={{ x: 1500 }} pagination={false} bordered />
      </Card>
      <FireModal open={modalOpen} editing={editing}
        onOk={() => { setModalOpen(false); load() }}
        onCancel={() => setModalOpen(false)} />
    </>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export default function FeeRatePage() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ position: 'sticky', top: 64, zIndex: 50, background: '#F5F7FA', paddingBottom: 12, borderBottom: '1px solid #f0f0f0', marginBottom: 4 }}>
        <Title level={4} style={{ margin: 0 }}>費率表作業</Title>
      </div>
      <Tabs
        style={{ marginTop: 4 }}
        defaultActiveKey="engineering"
        items={[
          { key: 'engineering', label: '工程險、責任險', children: <EngineeringTab /> },
          { key: 'fire',        label: '火險',          children: <FireTab /> },
        ]}
      />
    </div>
  )
}
