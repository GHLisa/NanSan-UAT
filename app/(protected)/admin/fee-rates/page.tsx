'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  Table, Card, Button, Typography, Modal, Form, Input, InputNumber,
  Select, AutoComplete, Checkbox, Popconfirm, Space, Divider, Row, Col, Tabs, Tooltip, message, DatePicker,
} from 'antd'
import type { FormInstance } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, InfoCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '@/lib/api'

const { Title, Text } = Typography

// ── 費率適用年度篩選（以「年」為單位，單一年度，預設當年度）────────────────────────
// 「適用年度 = Y」列出每間公司在 Y 年實際適用的費率版本：取生效年度 ≤ Y 之中「最新生效日」者。
// 若該公司無 Y 年新版，表示舊年度費率繼續適用，仍會被列出；生效年度 > Y（未來才生效）則排除。
type YearFilter = number | null

function applicableRatesForYear<T extends { companyCode: string; effectiveDate: string }>(rows: T[], year: YearFilter): T[] {
  if (!year) return rows
  const latestByCompany = new Map<string, T>()
  for (const r of rows) {
    if (Number(r.effectiveDate.slice(0, 4)) > year) continue
    const cur = latestByCompany.get(r.companyCode)
    if (!cur || r.effectiveDate > cur.effectiveDate) latestByCompany.set(r.companyCode, r)
  }
  return [...latestByCompany.values()]
}

function EffectiveYearFilter({ year, onChange }: { year: YearFilter; onChange: (y: YearFilter) => void }) {
  return (
    <Space size={6}>
      <Text type="secondary" style={{ fontSize: 12 }}>費率適用年度</Text>
      <DatePicker
        picker="year"
        size="small"
        style={{ width: 120 }}
        value={year ? dayjs(String(year)) : null}
        onChange={(v) => onChange(v ? v.year() : null)}
      />
    </Space>
  )
}

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
  { maxAmount: Number.MAX_SAFE_INTEGER, header: '20億以上' },
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
const INSURANCE_SELECT_OPTS = INSURANCE_OPTIONS.map(t => ({ value: t, label: t }))

// ── 公司代號欄位：下拉帶基礎資料保險公司，選取自動帶入公司名稱，允許自由輸入清單外的代號 ──
interface InsuranceCompany { id: number; code: string; name: string }

function useInsuranceCompanies(): InsuranceCompany[] {
  const [companies, setCompanies] = useState<InsuranceCompany[]>([])
  useEffect(() => {
    let active = true
    api.get<InsuranceCompany[]>('/api/admin/master-data/insurance-companies').then(res => {
      if (active && res.success && res.data) setCompanies(res.data)
    })
    return () => { active = false }
  }, [])
  return companies
}

// 自訂表單控件：須轉發 Form.Item 注入的 value/onChange/id；onSelect 額外帶入公司名稱
function CompanyCodeField(
  { form, disabled, value, onChange, ...rest }:
  { form: FormInstance; disabled: boolean; value?: string; onChange?: (v: string) => void },
) {
  const companies = useInsuranceCompanies()
  const options = companies.map(c => ({ value: c.code, label: `${c.code}　${c.name}` }))
  return (
    <AutoComplete
      {...rest}
      value={value}
      onChange={onChange}
      options={options}
      disabled={disabled}
      style={{ width: '100%' }}
      placeholder="輸入或選擇公司代號"
      filterOption={(input, option) =>
        String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
      onSelect={(v: string) => {
        const c = companies.find(x => x.code === v)
        if (c) form.setFieldsValue({ companyName: c.name })
      }}
    />
  )
}

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

// 費用補貼值（JSON 解碼後）：number=固定、null=改不給、0=不給、物件=分時/分地點、字串=文字說明（相片費）
type ExpenseVal =
  | number
  | string
  | null
  | { morning: number; noon: number; evening: number }
  | { taipei: number; other: number }

interface SubRate { insuranceType: string[]; rateBands: Band[] }

function parseBands(json: string): Band[] {
  try { return JSON.parse(json) ?? [] } catch { return [] }
}

function parseExpense(json: string): ExpenseVal {
  try { return JSON.parse(json) } catch { return 0 }
}

function parseSubRate(json: string | null): SubRate | null {
  if (!json) return null
  try {
    const sub = JSON.parse(json)
    if (!sub || !Array.isArray(sub.rateBands)) return null
    return {
      insuranceType: Array.isArray(sub.insuranceType) ? sub.insuranceType : [sub.insuranceType].filter(Boolean),
      rateBands: sub.rateBands,
    }
  } catch { return null }
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

function FmtExpense({ val }: { val: ExpenseVal }) {
  if (val === null) return <span style={{ color: '#dc2626', fontWeight: 600, fontSize: 12 }}>改不給</span>
  if (val === 0) return <span style={{ color: '#d1d5db' }}>—</span>
  if (typeof val === 'object' && 'morning' in val)
    return <span style={{ fontSize: 11 }}>早${val.morning}/午${val.noon}/晚${val.evening}</span>
  if (typeof val === 'object' && 'taipei' in val)
    return <span style={{ fontSize: 11 }}>北市${val.taipei.toLocaleString()}<br />其他${val.other.toLocaleString()}</span>
  return <span>${Number(val).toLocaleString()}</span>
}

function PhotoFee({ val }: { val: ExpenseVal }) {
  if (val === null) return <span style={{ color: '#dc2626', fontWeight: 600, fontSize: 12 }}>改不給</span>
  if (val === 0) return <span style={{ color: '#d1d5db' }}>—</span>
  return <span>{String(val)}</span>
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
  mealExpense: string; accommodationExpense: string; photoFee: string; effectiveDate: string
}
interface FireRate {
  id: number; companyCode: string; companyName: string
  debitNoteType: string; minFee: number; rateBands: string; remarks: string | null; effectiveDate: string
}

// 工程險表格列：主列＋附加險種子列（同一筆 DB 記錄展開為兩列）
interface EngRow extends EngRate {
  _key: string
  _isSub: boolean
  _rowSpan: number
  _displayTypes: string
  _bands: Band[]
}

// ── 費用補貼表單選項（對齊 demo CompanyModal）───────────────────────────────
const MEAL_OPTS = [
  { value: 'none', label: '不給（—）' },
  { value: 'fixed', label: '固定金額' },
  { value: 'time', label: '早/午/晚各別' },
  { value: 'not_given', label: '改不給' },
]
const ACCOM_OPTS = [
  { value: 'none', label: '不給（—）' },
  { value: 'fixed', label: '固定金額' },
  { value: 'location', label: '依地點（北市/其他）' },
  { value: 'not_given', label: '改不給' },
]
const PHOTO_OPTS = [
  { value: 'none', label: '不給（—）' },
  { value: 'fixed_num', label: '固定金額' },
  { value: 'text', label: '文字說明' },
  { value: 'not_given', label: '改不給' },
]

// ── Engineering Modal ──────────────────────────────────────────────────────
function EngModal({ open, editing, onOk, onCancel }: { open: boolean; editing: EngRate | null; onOk: () => void; onCancel: () => void }) {
  const [form] = Form.useForm()
  const mealType   = Form.useWatch('mealType',   form) ?? 'none'
  const accomType  = Form.useWatch('accomType',  form) ?? 'none'
  const photoType  = Form.useWatch('photoType',  form) ?? 'none'
  const hasSubRate = Form.useWatch('hasSubRate', form) ?? false

  useEffect(() => {
    if (open) {
      form.resetFields()
      if (editing) {
        const types = editing.insuranceType.split(',').filter(Boolean)

        // 餐費（對齊 demo toFormValues）
        const meal = parseExpense(editing.mealExpense)
        let mealVals: Record<string, unknown> = { mealType: 'none' }
        if (meal === null) mealVals = { mealType: 'not_given' }
        else if (typeof meal === 'object' && 'morning' in meal)
          mealVals = { mealType: 'time', mealMorning: meal.morning, mealNoon: meal.noon, mealEvening: meal.evening }
        else if (meal !== 0) mealVals = { mealType: 'fixed', mealFixed: meal }

        // 住宿費
        const accom = parseExpense(editing.accommodationExpense)
        let accomVals: Record<string, unknown> = { accomType: 'none' }
        if (accom === null) accomVals = { accomType: 'not_given' }
        else if (typeof accom === 'object' && 'taipei' in accom)
          accomVals = { accomType: 'location', accomTaipei: accom.taipei, accomOther: accom.other }
        else if (accom !== 0) accomVals = { accomType: 'fixed', accomFixed: accom }

        // 相片費
        const photo = parseExpense(editing.photoFee)
        let photoVals: Record<string, unknown> = { photoType: 'none' }
        if (photo === null) photoVals = { photoType: 'not_given' }
        else if (typeof photo === 'number' && photo !== 0) photoVals = { photoType: 'fixed_num', photoNum: photo }
        else if (typeof photo === 'string') photoVals = { photoType: 'text', photoText: photo }

        const sub = parseSubRate(editing.subRate)

        form.setFieldsValue({
          companyCode: editing.companyCode, companyName: editing.companyName,
          insuranceType: types, debitNoteType: editing.debitNoteType,
          minFee: editing.minFee, effectiveDate: editing.effectiveDate.slice(0, 10),
          ...mealVals, ...accomVals, ...photoVals,
          hasSubRate: !!sub,
          subInsuranceType: sub?.insuranceType ?? [],
        })
        populateBandFields(form, parseBands(editing.rateBands), 'band_', FR_BAND_COLS)
        if (sub) populateBandFields(form, sub.rateBands, 'subBand_', FR_BAND_COLS)
      } else {
        form.setFieldsValue({
          debitNoteType: '全額外加', minFee: 20000,
          mealType: 'none', accomType: 'none', photoType: 'none',
          hasSubRate: false, subInsuranceType: [],
        })
      }
    }
  }, [open, editing, form])

  async function handleOk() {
    try {
      const values = await form.validateFields()

      // 費用補貼 → JSON 編碼（對齊 demo fromFormValues）
      let mealExpense: ExpenseVal = 0
      switch (values.mealType) {
        case 'not_given': mealExpense = null; break
        case 'fixed': mealExpense = values.mealFixed ?? 0; break
        case 'time': mealExpense = { morning: values.mealMorning ?? 0, noon: values.mealNoon ?? 0, evening: values.mealEvening ?? 0 }; break
        default: mealExpense = 0
      }
      let accommodationExpense: ExpenseVal = 0
      switch (values.accomType) {
        case 'not_given': accommodationExpense = null; break
        case 'fixed': accommodationExpense = values.accomFixed ?? 0; break
        case 'location': accommodationExpense = { taipei: values.accomTaipei ?? 0, other: values.accomOther ?? 0 }; break
        default: accommodationExpense = 0
      }
      let photoFee: ExpenseVal = 0
      switch (values.photoType) {
        case 'not_given': photoFee = null; break
        case 'fixed_num': photoFee = values.photoNum ?? 0; break
        case 'text': photoFee = values.photoText ?? ''; break
        default: photoFee = 0
      }

      const subTypes: string[] = values.subInsuranceType ?? []
      const subRate = (values.hasSubRate && subTypes.length > 0)
        ? JSON.stringify({ insuranceType: subTypes, rateBands: JSON.parse(serializeBands(values, 'subBand_', FR_BAND_COLS)) })
        : null

      const body = {
        type: '工程',
        companyCode: values.companyCode, companyName: values.companyName,
        insuranceType: (values.insuranceType as string[]).join(','),
        debitNoteType: values.debitNoteType, minFee: values.minFee,
        rateBands: serializeBands(values, 'band_', FR_BAND_COLS),
        subRate,
        mealExpense: JSON.stringify(mealExpense),
        accommodationExpense: JSON.stringify(accommodationExpense),
        photoFee: JSON.stringify(photoFee),
        effectiveDate: values.effectiveDate,
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
              <CompanyCodeField form={form} disabled={!!editing} />
            </Form.Item>
          </Col>
          <Col span={7}>
            <Form.Item name="companyName" label="公司名稱" rules={[{ required: true, message: '必填' }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="insuranceType" label="險種（可複選）" rules={[{ required: true, type: 'array', min: 1, message: '請至少選擇一種' }]}>
              <Select mode="multiple" options={INSURANCE_SELECT_OPTS} placeholder="選擇險種" allowClear />
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
          <Col span={9}>
            <Form.Item label="餐費">
              <Form.Item name="mealType" noStyle>
                <Select options={MEAL_OPTS} style={{ width: '100%', marginBottom: 4 }} />
              </Form.Item>
              {mealType === 'fixed' && (
                <Form.Item name="mealFixed" noStyle>
                  <InputNumber min={0} style={{ width: '100%' }} placeholder="金額" />
                </Form.Item>
              )}
              {mealType === 'time' && (
                <Row gutter={4}>
                  <Col span={8}><Form.Item name="mealMorning" noStyle><InputNumber min={0} style={{ width: '100%' }} placeholder="早" /></Form.Item></Col>
                  <Col span={8}><Form.Item name="mealNoon" noStyle><InputNumber min={0} style={{ width: '100%' }} placeholder="午" /></Form.Item></Col>
                  <Col span={8}><Form.Item name="mealEvening" noStyle><InputNumber min={0} style={{ width: '100%' }} placeholder="晚" /></Form.Item></Col>
                </Row>
              )}
            </Form.Item>
          </Col>
          <Col span={9}>
            <Form.Item label="住宿費">
              <Form.Item name="accomType" noStyle>
                <Select options={ACCOM_OPTS} style={{ width: '100%', marginBottom: 4 }} />
              </Form.Item>
              {accomType === 'fixed' && (
                <Form.Item name="accomFixed" noStyle>
                  <InputNumber min={0} style={{ width: '100%' }} placeholder="金額" />
                </Form.Item>
              )}
              {accomType === 'location' && (
                <Row gutter={4}>
                  <Col span={3} style={{ lineHeight: '24px', fontSize: 11 }}>北市</Col>
                  <Col span={9}><Form.Item name="accomTaipei" noStyle><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
                  <Col span={3} style={{ lineHeight: '24px', fontSize: 11 }}>其他</Col>
                  <Col span={9}><Form.Item name="accomOther" noStyle><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
                </Row>
              )}
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="相片費">
              <Form.Item name="photoType" noStyle>
                <Select options={PHOTO_OPTS} style={{ width: '100%', marginBottom: 4 }} />
              </Form.Item>
              {photoType === 'fixed_num' && (
                <Form.Item name="photoNum" noStyle>
                  <InputNumber min={0} style={{ width: '100%' }} placeholder="金額" />
                </Form.Item>
              )}
              {photoType === 'text' && (
                <Form.Item name="photoText" noStyle>
                  <Input placeholder="說明文字" />
                </Form.Item>
              )}
            </Form.Item>
          </Col>
        </Row>

        <Divider style={{ fontSize: 12, margin: '4px 0 8px' }}>附加險種費率</Divider>
        <Form.Item name="hasSubRate" valuePropName="checked" style={{ marginBottom: hasSubRate ? 8 : 0 }}>
          <Checkbox>有附加險種費率</Checkbox>
        </Form.Item>
        {hasSubRate && (
          <>
            <Form.Item name="subInsuranceType" label="附加險種（可複選）"
              rules={[{ required: true, type: 'array', min: 1, message: '請至少選擇一種險種' }]}>
              <Select mode="multiple" options={INSURANCE_SELECT_OPTS} placeholder="選擇附加險種" allowClear />
            </Form.Item>
            <BandInputs prefix="subBand_" cols={FR_BAND_COLS} />
          </>
        )}
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
          effectiveDate: editing.effectiveDate.slice(0, 10), remarks: editing.remarks ?? '',
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
              <CompanyCodeField form={form} disabled={!!editing} />
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
  const [year, setYear] = useState<YearFilter>(() => new Date().getFullYear())

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

  const filteredRates = useMemo(() => applicableRatesForYear(rates, year), [rates, year])

  // 主列＋附加險種子列（對齊 demo tableData：subRate 展開為第二列，共用欄位以 rowSpan 合併）
  const tableData = useMemo<EngRow[]>(() => {
    const rows: EngRow[] = []
    filteredRates.forEach(co => {
      const sub = parseSubRate(co.subRate)
      rows.push({
        ...co,
        _key: String(co.id),
        _isSub: false,
        _rowSpan: sub ? 2 : 1,
        _displayTypes: co.insuranceType.split(',').filter(Boolean).join('、'),
        _bands: parseBands(co.rateBands),
      })
      if (sub) {
        rows.push({
          ...co,
          _key: `${co.id}-sub`,
          _isSub: true,
          _rowSpan: 0,
          _displayTypes: sub.insuranceType.join('、'),
          _bands: sub.rateBands,
        })
      }
    })
    return rows
  }, [filteredRates])

  function handleEdit(r: EngRow) {
    setEditing(rates.find(co => co.id === r.id) ?? r)
    setModalOpen(true)
  }

  // 合併儲存格：子列 rowSpan=0、主列 rowSpan=_rowSpan
  const mergedCell = (r: EngRow) => ({ rowSpan: r._isSub ? 0 : r._rowSpan })

  const bandCols = FR_BAND_COLS.map(band => ({
    title: band.header, key: `b_${band.maxAmount}`, align: 'center' as const, width: 80,
    render: (_: unknown, r: EngRow) => {
      const b = r._bands.find(x => x.maxAmount === band.maxAmount) ?? null
      return <FmtRate band={b} />
    },
  }))

  const columns = [
    {
      title: '公司', key: 'company', width: 90, fixed: 'left' as const,
      onCell: mergedCell,
      render: (_: unknown, r: EngRow) => (
        <div>
          <strong style={{ color: '#1B4F8C', fontSize: 15 }}>{r.companyCode}</strong>
          <br /><span style={{ fontSize: 12, color: '#999' }}>{r.companyName}</span>
        </div>
      ),
    },
    {
      title: '險種', key: 'type', width: 140,
      render: (_: unknown, r: EngRow) => r._isSub
        ? <span style={{ fontSize: 12, color: '#888', fontStyle: 'italic', paddingLeft: 12 }}>{r._displayTypes}</span>
        : <span style={{ fontSize: 13 }}>{r._displayTypes}</span>,
    },
    {
      title: 'DEBIT NOTE', key: 'debit', width: 100,
      onCell: mergedCell,
      render: (_: unknown, r: EngRow) => <DebitTag type={r.debitNoteType} />,
    },
    {
      title: '最低費', key: 'min', width: 80, align: 'right' as const,
      onCell: mergedCell,
      render: (_: unknown, r: EngRow) => `$${r.minFee.toLocaleString()}`,
    },
    {
      title: '費率', align: 'center' as const,
      children: bandCols,
    },
    {
      title: '餐費', key: 'meal', width: 90, align: 'center' as const,
      onCell: mergedCell,
      render: (_: unknown, r: EngRow) => <FmtExpense val={parseExpense(r.mealExpense)} />,
    },
    {
      title: '住宿', key: 'accom', width: 100, align: 'center' as const,
      onCell: mergedCell,
      render: (_: unknown, r: EngRow) => <FmtExpense val={parseExpense(r.accommodationExpense)} />,
    },
    {
      title: '相片費', key: 'photo', width: 65, align: 'center' as const,
      onCell: mergedCell,
      render: (_: unknown, r: EngRow) => <PhotoFee val={parseExpense(r.photoFee)} />,
    },
    {
      title: '生效日', key: 'date', width: 95, align: 'center' as const,
      onCell: mergedCell,
      render: (_: unknown, r: EngRow) => r.effectiveDate.slice(0, 10),
    },
    {
      title: '操作', key: 'action', width: 80, align: 'center' as const, fixed: 'right' as const,
      render: (_: unknown, r: EngRow) => {
        if (r._isSub) {
          return (
            <Button type="link" size="small" icon={<EditOutlined />}
              onClick={() => handleEdit(r)} style={{ padding: '0 4px' }} />
          )
        }
        return (
          <Space size={2}>
            <Button type="link" size="small" icon={<EditOutlined />}
              onClick={() => handleEdit(r)} style={{ padding: '0 4px' }} />
            <Popconfirm title="確認刪除此保險公司？" okText="刪除" cancelText="取消" okType="danger" onConfirm={() => handleDelete(r.id)}>
              <Button type="link" size="small" icon={<DeleteOutlined />} danger style={{ padding: '0 4px' }} />
            </Popconfirm>
          </Space>
        )
      },
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <EffectiveYearFilter year={year} onChange={setYear} />
        <Button type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C' }}
          onClick={() => { setEditing(null); setModalOpen(true) }}>
          新增保險公司
        </Button>
      </div>
      <Card size="small">
        <Table dataSource={tableData} columns={columns} rowKey="_key" loading={loading}
          size="small" scroll={{ x: 1400 }} pagination={false} bordered
          onRow={r => (r._isSub ? { style: { background: '#fafaf8' } } : {})} />
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
  const [year, setYear] = useState<YearFilter>(() => new Date().getFullYear())
  const filteredRates = useMemo(() => applicableRatesForYear(rates, year), [rates, year])

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
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <EffectiveYearFilter year={year} onChange={setYear} />
          <Button type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C', flexShrink: 0, marginLeft: 16 }}
            onClick={() => { setEditing(null); setModalOpen(true) }}>
            新增保險公司
          </Button>
        </div>
        <Text type="secondary" style={{ fontSize: 11 }}>
          ＊大多數保險公司採 4 段費率（≤500萬 / 500~2000萬 / 2000萬~1億 / 1億~5億）；「500~1000萬」與「1000~2000萬」顯示相同費率為正常現象。
          有 <InfoCircleOutlined style={{ color: '#d97706' }} /> 圖示者表示有特殊計費備註，滑鼠移入可查看。
        </Text>
      </div>
      <Card size="small">
        <Table dataSource={filteredRates} columns={columns} rowKey="id" loading={loading}
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
