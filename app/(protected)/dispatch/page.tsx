'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Table, Button, Card, Typography, Tag, Space, Modal, Form, Input, Select,
  message, Tooltip, DatePicker, InputNumber, Divider, Alert, Descriptions, Checkbox, Row, Col,
} from 'antd'
import { PlusOutlined, MinusCircleOutlined, DeleteOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import { canDispatch } from '@/lib/permissions'
import dayjs from 'dayjs'

const { Title, Text } = Typography
const { Search } = Input

const SOURCE_OPTIONS = [
  { value: 'Email', label: 'Email' },
  { value: 'NAS路徑', label: 'NAS 路徑' },
  { value: '其他', label: '其他' },
]
const SOURCE_PLACEHOLDER: Record<string, string> = {
  'Email': '請貼上郵件主旨或委任函標題',
  'NAS路徑': '例：\\\\NAS-TP\\incoming\\2025\\FB-20250408',
  '其他': '說明來源方式',
}
const CONTACT_FORM_STATUS = ['待傳', '已回傳', '無']
const PARKING_STATUS = ['申訴中', '訴訟中', '待請求時效']

interface Assignee { employeeId: number | null; role: string; ratio: number }
interface DraftPayload {
  formValues?: Record<string, unknown>
  assignees?: Assignee[]
  insuranceType?: string
  estimatedAmount?: number
  deductible?: number
  savedAt?: string
}
interface CoInsurer { _key: number; companyId: number | null; policyNumber: string; ratio: number | null }

interface PoolItem {
  _type: 'queue' | 'case'
  id: number
  desc: string
  draftData: string | null
  insuranceCompanyId: number
  insuranceCompanyName: string
  brokerCompanyId: number | null
  brokerCompanyName: string | null
  assignedDepartmentId: number
  departmentName: string
  incidentLocation: string | null
  insuranceType: string | null
  info: string | null
  time: string
}

interface MetaData {
  departments: { id: number; name: string; code: string; regionId: number }[]
  insuranceCompanies: { id: number; code: string; name: string }[]
  brokerCompanies: { id: number; name: string }[]
  insuranceTypes: { id: number; name: string; feeCategory: string }[]
  incidentLocations: { id: number; name: string }[]
  incidentCauses: { id: number; name: string }[]
  employees: { id: number; name: string }[]
}

// ── 承辦人元件（共用）──────────────────────────────────────────────────
// [效能] 定義於模組層級：原本宣告在 DispatchListPage 內部，每次 render 都會
// 產生「新的元件型別」，導致整段承辦人 Card（多個 Select / InputNumber）被
// unmount→remount，造成 Modal 內輸入卡頓甚至失焦。改吃 employees prop。
function AssigneeSection({ list, onChange, employees }: {
  list: Assignee[]
  onChange: (list: Assignee[]) => void
  employees: { id: number; name: string }[]
}) {
  const total = list.reduce((s, a) => s + (a.ratio || 0), 0)
  return (
    <Card
      title="承辦人設定"
      size="small"
      styles={{ header: { background: '#EBF4FC', borderLeft: '4px solid #1B4F8C' } }}
      extra={
        <Button size="small" icon={<PlusOutlined />}
          onClick={() => onChange([...list, { employeeId: null, role: '協辦', ratio: 0 }])}>
          新增
        </Button>
      }
    >
      {list.map((a, i) => (
        <Row key={i} gutter={6} align="middle" style={{ marginBottom: 8 }}>
          <Col flex="1">
            <Select style={{ width: '100%' }} placeholder="選擇承辦人"
              value={a.employeeId}
              onChange={v => onChange(list.map((x, idx) => idx === i ? { ...x, employeeId: v } : x))}
              options={employees.map(e => ({ value: e.id, label: e.name }))}
              showSearch optionFilterProp="label"
            />
          </Col>
          <Col>
            <Select style={{ width: 72 }} value={a.role}
              onChange={v => onChange(list.map((x, idx) => idx === i ? { ...x, role: v } : x))}
              options={[{ value: '主辦', label: '主辦' }, { value: '協辦', label: '協辦' }]}
            />
          </Col>
          <Col>
            <InputNumber style={{ width: 80 }} min={0} max={100}
              value={Math.round(a.ratio * 100)}
              onChange={v => onChange(list.map((x, idx) => idx === i ? { ...x, ratio: (v ?? 0) / 100 } : x))}
              addonAfter="%" />
          </Col>
          {list.length > 1 && (
            <Col>
              <MinusCircleOutlined style={{ color: '#ff4d4f', cursor: 'pointer' }}
                onClick={() => onChange(list.filter((_, idx) => idx !== i))} />
            </Col>
          )}
        </Row>
      ))}
      <Text type={Math.abs(total - 1.0) < 0.01 ? 'secondary' : 'danger'} style={{ fontSize: 12 }}>
        比例合計：{Math.round(total * 100)}%（須為 100%）
      </Text>
    </Card>
  )
}

export default function DispatchListPage() {
  const { session } = useAuth()
  const [items, setItems] = useState<PoolItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // FR-05（v3.2）：行政人員比照執行副總/系統管理員，派案池預設不限部門
  //（行政常跨部門派案，預設鎖本部門會導致指派他部門後看不到該筆）
  const [filterDeptId, setFilterDeptId] = useState<number | null>(
    session && ['admin_staff', 'vp', 'sysadmin'].includes(session.role) ? null : (session?.departmentId ?? null),
  )
  const [meta, setMeta] = useState<MetaData | null>(null)

  // 新增派案 modal
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false)
  const [dispatchForm] = Form.useForm()
  const [sourceType, setSourceType] = useState('Email')

  // 新增案件 modal（queue 取件）
  const [caseModalOpen, setCaseModalOpen] = useState(false)
  const [caseForm] = Form.useForm()
  const [activeDispatch, setActiveDispatch] = useState<PoolItem | null>(null)
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [estimatedAmount, setEstimatedAmount] = useState(0)
  const [deductible, setDeductible] = useState(0)
  const [insuranceType, setInsuranceType] = useState('營造綜合險')
  const [selectedIcId, setSelectedIcId] = useState<number | null>(null)
  const [commDate, setCommDate] = useState<string | null>(null)
  const [newCoInsurers, setNewCoInsurers] = useState<CoInsurer[]>([])
  const [feeCalcResult, setFeeCalcResult] = useState<{
    fee: number
    bands: { range: string; amount: number; rate: number; fee: number }[]
    minApplied: boolean
    feeCategory: string
  } | null>(null)

  // 指派承辦人 modal（case 取件）
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [activeCase, setActiveCase] = useState<PoolItem | null>(null)
  const [caseAssignees, setCaseAssignees] = useState<Assignee[]>([])

  const fetchPool = useCallback(async () => {
    setLoading(true)
    const res = await api.get<PoolItem[]>('/api/dispatch?mode=pool')
    if (res.success && res.data) setItems(res.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchPool()
    api.get<MetaData>('/api/meta').then(res => { if (res.success && res.data) setMeta(res.data) })
  }, [fetchPool])

  // 費用試算
  useEffect(() => {
    if (!estimatedAmount || estimatedAmount <= 0 || !selectedIcId || !meta) {
      setFeeCalcResult(null)
      return
    }
    const insType = meta.insuranceTypes.find(t => t.name === insuranceType)
    if (!insType) return
    api.post<{
      fee: number
      bands: { range: string; amount: number; rate: number; fee: number }[]
      minApplied: boolean
      feeCategory: string
    }>('/api/fee-calc', {
      amount: estimatedAmount,
      insuranceCompanyId: selectedIcId,
      insuranceTypeId: insType.id,
      commissionDate: commDate ?? undefined,
    }).then(res => {
      if (res.success && res.data) setFeeCalcResult(res.data)
      else setFeeCalcResult(null)
    })
  }, [estimatedAmount, selectedIcId, insuranceType, commDate, meta])

  // 搜尋篩選
  const filtered = useMemo(() => {
    return items.filter(r => {
      if (filterDeptId && r.assignedDepartmentId !== filterDeptId) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          r.desc.toLowerCase().includes(q) ||
          r.insuranceCompanyName.toLowerCase().includes(q) ||
          (r.incidentLocation?.toLowerCase().includes(q) ?? false)
        )
      }
      return true
    })
  }, [items, search, filterDeptId])

  // 預設承辦人：僅當登入者角色為「承辦人(handler)」時才帶入自己為主辦，
  // 其餘角色（行政/主管/副總等）不預設，需於取件時手動指定承辦人。
  function defaultAssignees(): Assignee[] {
    const selfId = session?.role === 'handler' ? parseInt(session.sub) : null
    return [{ employeeId: selfId, role: '主辦', ratio: 1.0 }]
  }

  // ── Queue 取件：開新增案件 modal ──────────────────────────────────────
  function handleQueuePickup(record: PoolItem) {
    setActiveDispatch(record)
    caseForm.resetFields()
    setNewCoInsurers([])
    setFeeCalcResult(null)
    setSelectedIcId(record.insuranceCompanyId)

    // FR-79 取件：若有暫存資料則自動還原
    let draft: DraftPayload | null = null
    if (record.draftData) {
      try { draft = JSON.parse(record.draftData) as DraftPayload } catch { draft = null }
    }

    if (draft) {
      const fv = draft.formValues ?? {}
      caseForm.setFieldsValue({
        ...fv,
        incidentDate: fv.incidentDate ? dayjs(fv.incidentDate as string) : null,
        commissionDate: fv.commissionDate ? dayjs(fv.commissionDate as string) : null,
        contactReturnDate: fv.contactReturnDate ? dayjs(fv.contactReturnDate as string) : null,
      })
      setAssignees(draft.assignees ?? defaultAssignees())
      setEstimatedAmount(draft.estimatedAmount ?? 0)
      setDeductible(draft.deductible ?? 0)
      setInsuranceType(draft.insuranceType ?? '營造綜合險')
      setCommDate((fv.commissionDate as string) ?? null)
    } else {
      setAssignees(defaultAssignees())
      setEstimatedAmount(0)
      setDeductible(0)
      setInsuranceType('營造綜合險')
      setCommDate(null)
      caseForm.setFieldsValue({
        insuranceCompanyId: record.insuranceCompanyId,
        brokerCompanyId: record.brokerCompanyId ?? null,
        contactFormStatus: '待傳',
      })
    }
    setCaseModalOpen(true)
  }

  // FR-79 暫存：不驗證必填，僅寫入 draftData，狀態維持「待取件」
  async function handleDraftSave() {
    if (!activeDispatch) return
    const values = caseForm.getFieldsValue()
    const draftData: DraftPayload = {
      formValues: {
        ...values,
        incidentDate: (values.incidentDate as dayjs.Dayjs)?.format('YYYY-MM-DD') ?? null,
        commissionDate: (values.commissionDate as dayjs.Dayjs)?.format('YYYY-MM-DD') ?? null,
        contactReturnDate: (values.contactReturnDate as dayjs.Dayjs)?.format('YYYY-MM-DD') ?? null,
      },
      assignees,
      insuranceType,
      estimatedAmount,
      deductible,
      savedAt: dayjs().format(),
    }
    const res = await api.patch(`/api/dispatch/${activeDispatch.id}`, {
      action: 'draft',
      draftData: JSON.stringify(draftData),
    })
    if (res.success) {
      message.success('已暫存')
      setCaseModalOpen(false)
      setActiveDispatch(null)
      fetchPool()
      window.dispatchEvent(new Event('nansan:case-updated'))
    } else {
      message.error(res.error ?? '暫存失敗')
    }
  }

  async function handleCaseSubmit(values: Record<string, unknown>) {
    // 成案前置：須設定主辦承辦人（非承辦人登入時不預設，避免空白送件）
    const primary = assignees.find(a => a.role === '主辦')
    if (!primary?.employeeId) {
      message.error('請先設定主辦承辦人才能成案')
      return
    }
    const totalRatio = assignees.reduce((s, a) => s + (a.ratio || 0), 0)
    if (Math.abs(totalRatio - 1.0) > 0.01) {
      message.error('承辦人分工比例合計必須等於 100%')
      return
    }
    // FR-92 承辦部門：採派案記錄 assignedDepartmentId，fallback 登入者部門
    const targetDeptId = activeDispatch?.assignedDepartmentId ?? session?.departmentId ?? null
    if (!targetDeptId) { message.error('無法確認部門'); return }

    const body = {
      caseNumber: (values.caseNumber as string)?.trim() || undefined,
      departmentId: targetDeptId,
      insuranceCompanyId: values.insuranceCompanyId as number,
      brokerCompanyId: (values.brokerCompanyId as number) || null,
      insuranceContact: values.insuranceContact as string || undefined,
      policyNumber: values.policyNumber as string,
      insuredName: values.insuredName as string,
      incidentLocation: values.incidentLocation as string,
      incidentDate: (values.incidentDate as dayjs.Dayjs).format('YYYY-MM-DD'),
      commissionDate: (values.commissionDate as dayjs.Dayjs).format('YYYY-MM-DD'),
      insuranceType: values.insuranceType as string,
      incidentCause: values.incidentCause as string,
      estimatedAmount: estimatedAmount || null,
      deductible: deductible || 0,
      isSpecialCase: values.isSpecialCase as boolean || false,
      notes: values.notes as string || undefined,
      contactFormStatus: values.contactFormStatus as string || undefined,
      contactReturnDate: (values.contactReturnDate as dayjs.Dayjs)?.format('YYYY-MM-DD') || null,
      nasFolder: values.nasFolder as string || undefined,
      parkingStatus: values.parkingStatus as string || null,
      estimatedFee: feeCalcResult?.fee,
      coInsurers: newCoInsurers.map(({ companyId, policyNumber, ratio }) => ({ companyId, policyNumber, ratio: ratio ?? 0 })),
      assignments: assignees.filter(a => a.employeeId).map(a => ({ employeeId: a.employeeId!, role: a.role, contributionRatio: a.ratio })),
      dispatchId: activeDispatch?._type === 'queue' ? activeDispatch.id : undefined,
    }

    await submitCase(body)
  }

  // FR-80：建案送出，遇 DUPLICATE_POLICY 以 Modal.confirm 詢問後帶 confirmDuplicate 重送
  async function submitCase(body: Record<string, unknown>) {
    const res = await api.post<{ caseNumber: string }>('/api/cases', body)
    if (res.success && res.data) {
      message.success(`案件 ${res.data.caseNumber} 成案成功！`)
      setCaseModalOpen(false)
      setActiveDispatch(null)
      setNewCoInsurers([])
      fetchPool()
      window.dispatchEvent(new Event('nansan:case-updated'))
      return
    }
    if ((res as { code?: string }).code === 'DUPLICATE_POLICY') {
      Modal.confirm({
        title: '可能重複建檔',
        content: res.error ?? '已有相同保險公司＋保單號碼的未銷案案件，請確認是否重複建檔',
        okText: '確認新增',
        cancelText: '取消',
        onOk: () => submitCase({ ...body, confirmDuplicate: true }),
      })
      return
    }
    message.error(res.error ?? '建案失敗')
  }

  // ── Case 取件：指派承辦人 ─────────────────────────────────────────────
  function handleCasePickup(record: PoolItem) {
    setActiveCase(record)
    setCaseAssignees(defaultAssignees())
    setAssignModalOpen(true)
  }

  async function handleCaseAssign() {
    if (!activeCase) return
    // 成案前置：須設定主辦承辦人（非承辦人登入時不預設，避免空白送件）
    const primary = caseAssignees.find(a => a.role === '主辦')
    if (!primary?.employeeId) {
      message.error('請先設定主辦承辦人才能成案')
      return
    }
    const totalRatio = caseAssignees.reduce((s, a) => s + (a.ratio || 0), 0)
    if (Math.abs(totalRatio - 1.0) > 0.01) {
      message.error('承辦人分工比例合計必須等於 100%')
      return
    }
    const res = await api.post(`/api/cases/${activeCase.id}/assign`, {
      assignees: caseAssignees.filter(a => a.employeeId).map(a => ({
        employeeId: a.employeeId!, role: a.role, contributionRatio: a.ratio,
      })),
    })
    if (res.success) {
      message.success(`案件已指派承辦人`)
      setAssignModalOpen(false)
      setActiveCase(null)
      fetchPool()
      window.dispatchEvent(new Event('nansan:case-updated'))
    } else {
      message.error(res.error ?? '指派失敗')
    }
  }

  // ── 新增派案 ─────────────────────────────────────────────────────────
  async function handleNewDispatch(values: Record<string, unknown>) {
    // [2026/07/01] - Lisa - 公證編號人工填入 → 存入 draftData，成案時自動帶出沿用（成案才判重與寫入）
    const manualCaseNumber = (values.caseNumber as string)?.trim()
    const res = await api.post('/api/dispatch', {
      ...values,
      insuranceCompanyId: Number(values.insuranceCompanyId),
      assignedDepartmentId: Number(values.assignedDepartmentId),
      brokerCompanyId: values.brokerCompanyId ? Number(values.brokerCompanyId) : null,
      draftData: manualCaseNumber ? JSON.stringify({ formValues: { caseNumber: manualCaseNumber } }) : undefined,
    })
    if (res.success) {
      message.success('派案建立成功')
      setDispatchModalOpen(false)
      dispatchForm.resetFields()
      setSourceType('Email')
      fetchPool()
    } else {
      message.error(res.error ?? '建立失敗')
    }
  }

  // ── 表格欄位 ──────────────────────────────────────────────────────────
  const columns = [
    {
      title: '類型', key: 'type', width: 88,
      render: (_: unknown, r: PoolItem) => r._type === 'queue'
        ? <Tag color="blue">待建案</Tag>
        : <Tag color="orange">待指派</Tag>,
    },
    {
      title: '說明 / 案號', key: 'desc', ellipsis: true,
      render: (_: unknown, r: PoolItem) => r._type === 'queue'
        ? <Tooltip title={r.desc}>
            <span>{r.desc}</span>
            {r.draftData && <Tag color="gold" style={{ marginLeft: 6, fontSize: 11 }}>已暫存</Tag>}
          </Tooltip>
        : <span style={{ fontWeight: 600 }}>{r.desc}</span>,
    },
    { title: '保險公司', dataIndex: 'insuranceCompanyName', key: 'ic', width: 130 },
    {
      title: '出險地點', dataIndex: 'incidentLocation', key: 'location', width: 110, ellipsis: true,
      render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
    },
    {
      title: '險種', dataIndex: 'insuranceType', key: 'type2', width: 100, ellipsis: true,
      render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
    },
    { title: '部門', dataIndex: 'departmentName', key: 'dept', width: 110 },
    {
      title: '交辦事項 / 出險原因', dataIndex: 'info', key: 'info', ellipsis: true,
      render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
    },
    {
      title: '時間', key: 'time', width: 100,
      render: (_: unknown, r: PoolItem) => r._type === 'queue'
        ? dayjs(r.time).format('MM/DD HH:mm')
        : dayjs(r.time).format('YYYY/MM/DD'),
    },
    {
      title: '操作', key: 'action', width: 80, fixed: 'right' as const,
      render: (_: unknown, r: PoolItem) => (
        <Button size="small" type="primary" style={{ background: '#1B4F8C' }}
          onClick={() => r._type === 'queue' ? handleQueuePickup(r) : handleCasePickup(r)}>
          取件
        </Button>
      ),
    },
  ]

  const estimatedCompensation = Math.max(0, estimatedAmount - deductible)
  const coTotal = newCoInsurers.reduce((s, c) => s + (c.ratio ?? 0), 0)

  // FR-92 承辦部門（唯讀）：派案記錄 assignedDepartmentId 對應名稱，fallback 登入者部門
  const assignedDeptId = activeDispatch?.assignedDepartmentId ?? session?.departmentId ?? null
  const assignedDeptName = (meta?.departments ?? []).find(d => d.id === assignedDeptId)?.name
    ?? session?.departmentName ?? '—'

  const deptOptions = [
    { value: null, label: '全部部門' },
    ...(meta?.departments ?? []).map(d => ({ value: d.id, label: d.name })),
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 16 }}>派案池</Title>

      {/* ── 搜尋列 ── */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[8, 8]} align="middle" wrap={false}>
          <Col flex="240px">
            <Search placeholder="搜尋說明、案號、保險公司..." onSearch={setSearch}
              onChange={e => !e.target.value && setSearch('')} allowClear />
          </Col>
          <Col>
            <Select value={filterDeptId} onChange={setFilterDeptId}
              options={deptOptions} style={{ width: 160 }} />
          </Col>
          <Col>
            <Button onClick={() => { setSearch(''); setFilterDeptId(null) }}>重置</Button>
          </Col>
          <Col style={{ marginLeft: 'auto' }}>
            {session && canDispatch(session.role) && (
              <Button type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C' }}
                onClick={() => { setDispatchModalOpen(true); setSourceType('Email'); dispatchForm.resetFields(); dispatchForm.setFieldValue('sourceType', 'Email') }}>
                新增派案
              </Button>
            )}
          </Col>
        </Row>
      </Card>

      {/* ── 主表格 ── */}
      <Table
        dataSource={filtered}
        columns={columns}
        rowKey={r => `${r._type}-${r.id}`}
        size="small"
        loading={loading}
        scroll={{ x: 1050 }}
        sticky={{ offsetHeader: 64 }}
        pagination={{ pageSize: 15, showTotal: t => `共 ${t} 筆` }}
      />

      {/* ── 新增案件 Modal（queue 取件）── */}
      <Modal
        title="新增案件"
        open={caseModalOpen}
        onCancel={() => { setCaseModalOpen(false); setActiveDispatch(null); setNewCoInsurers([]) }}
        footer={[
          <Button key="cancel" onClick={() => { setCaseModalOpen(false); setActiveDispatch(null) }}>取消</Button>,
          <Button key="draft" onClick={handleDraftSave}>暫存</Button>,
          <Button key="confirm" type="primary" style={{ background: '#1B4F8C' }} onClick={() => caseForm.submit()}>
            送出成案（自動取號）
          </Button>,
        ]}
        width={920}
        styles={{ body: { maxHeight: '75vh', overflowY: 'auto', padding: '16px 24px' } }}
      >
        {activeDispatch && (() => {
          let draftSavedAt: string | null = null
          if (activeDispatch.draftData) {
            try { draftSavedAt = (JSON.parse(activeDispatch.draftData) as DraftPayload).savedAt ?? null } catch { draftSavedAt = null }
          }
          const hasDraft = !!activeDispatch.draftData
          const draftNote = hasDraft
            ? `此派案已有暫存資料，已自動帶入${draftSavedAt ? `（${dayjs(draftSavedAt).format('MM/DD HH:mm')} 暫存）` : ''}。`
            : null
          const assignmentNote = activeDispatch.info ? `交辦事項：${activeDispatch.info}` : null
          const descLines = [assignmentNote, draftNote].filter(Boolean)
          return (
            <Alert
              message={`從派案池取件：${activeDispatch.desc}`}
              description={descLines.length ? descLines.join('　') : undefined}
              type={hasDraft ? 'warning' : 'info'}
              showIcon style={{ marginBottom: 16 }}
            />
          )
        })()}
        <Form form={caseForm} layout="vertical" size="small" onFinish={handleCaseSubmit}>
          <Row gutter={16}>
            {/* 左欄：基本資訊 */}
            <Col span={12}>
              <Card title="基本資訊" size="small" style={{ marginBottom: 12 }}
                styles={{ header: { background: '#EBF4FC', borderLeft: '4px solid #1B4F8C' } }}>
                <Row gutter={[12, 0]}>
                  <Col span={24}>
                    <Form.Item label="公證編號" name="caseNumber" extra="留空則由系統自動產生">
                      <Input placeholder="留空＝自動產生" maxLength={30} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="保險公司" name="insuranceCompanyId" rules={[{ required: true, message: '必選' }]}>
                      <Select options={(meta?.insuranceCompanies ?? []).map(i => ({ value: i.id, label: i.name }))}
                        placeholder="請選擇"
                        onChange={v => setSelectedIcId(v)} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="承辦部門">
                      <Input disabled value={assignedDeptName} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="保代/保經" name="brokerCompanyId">
                      <Select options={[{ value: null, label: '無' }, ...(meta?.brokerCompanies ?? []).map(b => ({ value: b.id, label: b.name }))]} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="被保險人" name="insuredName" rules={[{ required: true, message: '必填' }]}>
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="險種" name="insuranceType" rules={[{ required: true, message: '必選' }]}>
                      <Select options={(meta?.insuranceTypes ?? []).map(t => ({ value: t.name, label: t.name }))}
                        onChange={setInsuranceType} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="保單號碼" name="policyNumber" rules={[{ required: true, message: '必填' }]}>
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="出險原因" name="incidentCause" rules={[{ required: true, message: '必選' }]}>
                      <Select options={(meta?.incidentCauses ?? []).map(c => ({ value: c.name, label: c.name }))} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="保險公司承辦人" name="insuranceContact">
                      <Input placeholder="選填" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="出險地點" name="incidentLocation" rules={[{ required: true, message: '必填' }]}>
                      <Select showSearch allowClear placeholder="請選擇出險/查勘地點"
                        options={(meta?.incidentLocations ?? []).map(l => ({ value: l.name, label: l.name }))}
                        filterOption={(input, opt) => (opt?.label ?? '').includes(input)} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="出險日期" name="incidentDate" rules={[{ required: true, message: '必填' }]}>
                      <DatePicker style={{ width: '100%' }} disabledDate={d => d.isAfter(dayjs())} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="委託日期" name="commissionDate" rules={[{ required: true, message: '必填' }]}>
                      <DatePicker style={{ width: '100%' }} disabledDate={d => d.isAfter(dayjs())}
                        onChange={v => setCommDate(v?.format('YYYY-MM-DD') ?? null)} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="聯絡單狀態" name="contactFormStatus">
                      <Select options={CONTACT_FORM_STATUS.map(v => ({ value: v, label: v }))} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="回傳日期" name="contactReturnDate">
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="parkingStatus" label="停泊案件狀態">
                      <Select allowClear placeholder="無" options={PARKING_STATUS.map(s => ({ value: s, label: s }))} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="NAS 路徑" name="nasFolder">
                      <Input placeholder="\\NAS-TP\cases\..." />
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <Form.Item label="備註" name="notes">
                      <Input.TextArea rows={2} placeholder="選填" />
                    </Form.Item>
                  </Col>
                  {/* 共保資訊 */}
                  <Col span={24}>
                    <Form.Item
                      label={
                        <Space>
                          共保資訊
                          <Button size="small" type="primary" icon={<PlusOutlined />}
                            style={{ background: '#2E86C1' }}
                            onClick={() => setNewCoInsurers(prev => [...prev, { _key: Date.now(), companyId: null, policyNumber: '', ratio: null }])}>
                            新增共保
                          </Button>
                        </Space>
                      }
                    >
                      {newCoInsurers.length > 0 && (
                        <Row style={{ marginBottom: 4 }}>
                          <Col flex="1"><Text style={{ fontSize: 11, color: '#888' }}>共保公司（選填）</Text></Col>
                          <Col flex="1"><Text style={{ fontSize: 11, color: '#888' }}>共保保單號碼</Text></Col>
                          <Col flex="0 0 110px" style={{ textAlign: 'center' }}><Text style={{ fontSize: 11, color: '#888' }}>共保比例</Text></Col>
                          <Col flex="0 0 32px" />
                        </Row>
                      )}
                      {newCoInsurers.map((ci, idx) => (
                        <Row key={ci._key} gutter={6} align="middle" style={{ marginBottom: 6 }}>
                          <Col flex="1">
                            <Select allowClear showSearch placeholder="選填"
                              value={ci.companyId}
                              onChange={v => setNewCoInsurers(p => p.map((x, i) => i === idx ? { ...x, companyId: v ?? null } : x))}
                              options={(meta?.insuranceCompanies ?? []).map(i => ({ value: i.id, label: i.name }))}
                              filterOption={(input, opt) => (opt?.label ?? '').includes(input)}
                              style={{ width: '100%' }} />
                          </Col>
                          <Col flex="1">
                            <Input placeholder="必填" value={ci.policyNumber}
                              onChange={e => setNewCoInsurers(p => p.map((x, i) => i === idx ? { ...x, policyNumber: e.target.value } : x))}
                              status={ci.policyNumber === '' ? 'error' : ''} />
                          </Col>
                          <Col flex="0 0 110px">
                            <InputNumber min={0.01} max={99.99} precision={2} step={5}
                              addonAfter="%" placeholder="必填"
                              value={ci.ratio}
                              onChange={v => setNewCoInsurers(p => p.map((x, i) => i === idx ? { ...x, ratio: v ?? null } : x))}
                              status={!ci.ratio ? 'error' : ''}
                              style={{ width: '100%' }} />
                          </Col>
                          <Col flex="0 0 32px">
                            <Button type="text" danger icon={<DeleteOutlined />}
                              onClick={() => setNewCoInsurers(p => p.filter((_, i) => i !== idx))} />
                          </Col>
                        </Row>
                      ))}
                      {newCoInsurers.length > 0 && (() => {
                        const mainRatio = 100 - coTotal
                        const maxCoRatio = Math.max(...newCoInsurers.map(c => c.ratio ?? 0))
                        const valid = coTotal < 100 && mainRatio >= maxCoRatio
                        const icName = (meta?.insuranceCompanies ?? []).find(i => i.id === selectedIcId)?.name
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: valid ? '#f6ffed' : '#fff2f0', border: `1px solid ${valid ? '#b7eb8f' : '#ffccc7'}`, borderRadius: 4, fontSize: 12 }}>
                            <Text style={{ flex: 1, fontSize: 12 }}>主保人{icName ? `（${icName}）` : ''}剩餘比例</Text>
                            <Text strong style={{ color: valid ? '#52c41a' : '#ff4d4f' }}>{(100 - coTotal).toFixed(2).replace(/\.?0+$/, '')}%</Text>
                            {!valid && <Text type="danger" style={{ fontSize: 11 }}>{coTotal >= 100 ? '共保比例合計已達 100%' : '須大於等於各共保比例'}</Text>}
                          </div>
                        )
                      })()}
                    </Form.Item>
                  </Col>
                  {/* 特殊案件 */}
                  <Col span={24}>
                    <Form.Item shouldUpdate noStyle>
                      {({ getFieldValue }) => (
                        <>
                          <Form.Item name="isSpecialCase" valuePropName="checked" style={{ marginBottom: 4 }}>
                            <Checkbox>
                              <Text strong style={{ fontSize: 13 }}>特殊案件</Text>
                              <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>（關注案件、存在極大爭議、複雜度或金額較高…）</Text>
                            </Checkbox>
                          </Form.Item>
                          {getFieldValue('isSpecialCase') && (
                            <div style={{ marginBottom: 8, padding: '4px 10px', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 4, fontSize: 12, color: '#d46b08' }}>
                              ⚠️ 已標記為特殊案件，不論文件類型與金額，所有送審文件均需部門主管審核後轉執行副總閱示
                            </div>
                          )}
                        </>
                      )}
                    </Form.Item>
                  </Col>
                </Row>
              </Card>
            </Col>

            {/* 右欄：金額 + 承辦人 */}
            <Col span={12}>
              <Card title="金額資訊" size="small" style={{ marginBottom: 12 }}
                styles={{ header: { background: '#EBF4FC', borderLeft: '4px solid #1B4F8C' } }}>
                <Row gutter={[12, 0]}>
                  <Col span={12}>
                    <Form.Item label="預估金額" name="estimatedAmount">
                      <InputNumber style={{ width: '100%' }} min={1} max={9_999_999_999}
                        formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={v => parseInt((v ?? '').replace(/,/g, ''), 10) as unknown as never}
                        onChange={v => setEstimatedAmount(v || 0)} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="自負額" name="deductible">
                      <InputNumber style={{ width: '100%' }} min={0}
                        formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={v => parseInt((v ?? '').replace(/,/g, ''), 10) as unknown as never}
                        onChange={v => setDeductible(v || 0)} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="預估賠償額">
                      <InputNumber style={{ width: '100%' }} value={estimatedCompensation} disabled
                        formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} />
                    </Form.Item>
                  </Col>
                </Row>
                {feeCalcResult && (
                  <Card size="small" style={{ background: '#EBF4FC', border: '1px solid #2E86C1', marginTop: 8 }}>
                    <Text strong style={{ color: '#1B4F8C' }}>預估公證費：${feeCalcResult.fee.toLocaleString()}</Text>
                    <Divider style={{ margin: '8px 0' }} />
                    {feeCalcResult.bands.map((b, i) => (
                      <Text key={i} type="secondary" style={{ display: 'block', fontSize: 12 }}>
                        {b.range}：${b.amount.toLocaleString()} × {(b.rate * 100).toFixed(2)}% = ${b.fee.toLocaleString()}
                      </Text>
                    ))}
                    {feeCalcResult.minApplied && (
                      <Text type="secondary" style={{ display: 'block', fontSize: 12, color: '#d46b08' }}>
                        ※ 低於最低公證費門檻，以最低費 $20,000 計
                      </Text>
                    )}
                  </Card>
                )}
              </Card>
              <AssigneeSection list={assignees} onChange={setAssignees} employees={meta?.employees ?? []} />
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* ── 指派承辦人 Modal（case 取件）── */}
      <Modal
        title="指派承辦人"
        open={assignModalOpen}
        onCancel={() => { setAssignModalOpen(false); setActiveCase(null) }}
        footer={[
          <Button key="cancel" onClick={() => { setAssignModalOpen(false); setActiveCase(null) }}>取消</Button>,
          <Button key="confirm" type="primary" style={{ background: '#1B4F8C' }} onClick={handleCaseAssign}>送出成案</Button>,
        ]}
        width={520}
      >
        {activeCase && (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginTop: 8, marginBottom: 16 }}
              labelStyle={{ width: 110, fontWeight: 500 }}>
              <Descriptions.Item label="案件資訊">{activeCase.desc}</Descriptions.Item>
              <Descriptions.Item label="保險公司">{activeCase.insuranceCompanyName}</Descriptions.Item>
              <Descriptions.Item label="委託日">
                {dayjs(activeCase.time).format('YYYY/MM/DD')}
              </Descriptions.Item>
            </Descriptions>
            <AssigneeSection list={caseAssignees} onChange={setCaseAssignees} employees={meta?.employees ?? []} />
          </>
        )}
      </Modal>

      {/* ── 新增派案 Modal ── */}
      <Modal
        title="新增派案"
        open={dispatchModalOpen}
        onCancel={() => { setDispatchModalOpen(false); dispatchForm.resetFields(); setSourceType('Email') }}
        onOk={() => dispatchForm.submit()}
        okText="確認新增"
        cancelText="取消"
        okButtonProps={{ style: { background: '#1B4F8C' } }}
        width={520}
      >
        <Form form={dispatchForm} layout="vertical" onFinish={handleNewDispatch} style={{ marginTop: 16 }}>
          <Form.Item name="caseNumber" label="公證編號" extra="留空則於成案時自動產生">
            <Input placeholder="留空＝自動產生" maxLength={30} />
          </Form.Item>
          <Form.Item name="sourceType" label="來源類型" initialValue="Email" rules={[{ required: true }]}>
            <Select options={SOURCE_OPTIONS} onChange={v => setSourceType(v)} />
          </Form.Item>
          <Form.Item name="sourceReference" label="來源參考（Email主旨/NAS路徑）" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder={SOURCE_PLACEHOLDER[sourceType] ?? '請輸入'} />
          </Form.Item>
          <Form.Item name="insuranceCompanyId" label="保險公司" rules={[{ required: true, message: '必填' }]}>
            <Select placeholder="請選擇保險公司"
              options={(meta?.insuranceCompanies ?? []).map(i => ({ value: i.id, label: i.name }))} />
          </Form.Item>
          <Form.Item name="brokerCompanyId" label="保代/保經公司">
            <Select options={[{ value: null, label: '無' }, ...(meta?.brokerCompanies ?? []).map(b => ({ value: b.id, label: b.name }))]}
              defaultValue={null} />
          </Form.Item>
          <Form.Item name="assignedDepartmentId" label="指派部門" rules={[{ required: true, message: '必填' }]}>
            <Select placeholder="請選擇指派部門"
              options={(meta?.departments ?? []).map(d => ({ value: d.id, label: d.name }))} />
          </Form.Item>
          <Form.Item name="assignmentNotes" label="交辦事項">
            <Input.TextArea rows={3} placeholder="請輸入交辦事項" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
