'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card, Form, Input, Button, Select, AutoComplete, DatePicker, InputNumber,
  Checkbox, Alert, Typography, Space, Divider, message, Modal, Row, Col, Table,
} from 'antd'
import { PlusOutlined, DeleteOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title, Text } = Typography
const { Option } = Select
const { TextArea } = Input

const CONTACT_FORM_STATUS = ['無', '待傳', '已回傳']
const PARKING_STATUS = ['申訴中', '訴訟中', '待請求時效']

interface MetaData {
  insuranceCompanies: { id: number; code: string; name: string }[]
  brokerCompanies: { id: number; name: string }[]
  departments: { id: number; name: string }[]
  employees: { id: number; name: string }[]
  insuranceTypes: { id: number; name: string }[]
  incidentLocations: { id: number; name: string }[]
  incidentCauses: { id: number; name: string }[]
}

interface AssignmentRow {
  key: string
  employeeId: number | null
  role: string
  contributionRatio: number
}

interface CoInsurerRow {
  key: string
  companyId: number | null
  policyNumber: string
  ratio: number | null
}

interface FeeBand {
  range: string
  amount: number
  rate: number
  fee: number
}

interface FeeCalcResult {
  fee: number
  bands: FeeBand[]
  minApplied: boolean
  feeCategory: string
}

const FEE_CALC_DEBOUNCE_MS = 500

export default function CaseNewPage() {
  const router = useRouter()
  const { session } = useAuth()
  const [form] = Form.useForm()
  const [meta, setMeta] = useState<MetaData>({
    insuranceCompanies: [],
    brokerCompanies: [],
    departments: [],
    employees: [],
    insuranceTypes: [],
    incidentLocations: [],
    incidentCauses: [],
  })
  const [assignments, setAssignments] = useState<AssignmentRow[]>([
    { key: '1', employeeId: null, role: '主辦', contributionRatio: 100 },
  ])
  const [coInsurers, setCoInsurers] = useState<CoInsurerRow[]>([])
  const [isSpecialCase, setIsSpecialCase] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // ── 公證費試算 ──
  const [feeCalc, setFeeCalc] = useState<FeeCalcResult | null>(null)
  const [estimatedAmount, setEstimatedAmount] = useState<number | null>(null)
  const [insuranceCompanyId, setInsuranceCompanyId] = useState<number | null>(null)
  const [insuranceTypeId, setInsuranceTypeId] = useState<number | null>(null)
  const [commissionDate, setCommissionDate] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    api.get<MetaData>('/api/meta').then((res) => {
      if (res.success && res.data) setMeta(res.data)
    })
  }, [])

  // 登入者部門帶入 form（送出時使用）
  useEffect(() => {
    if (session?.departmentId) {
      form.setFieldsValue({ departmentId: session.departmentId })
    }
  }, [session, form])

  // 預設第一筆承辦人為登入者本人（主辦、100%）；行政人員除外（由其指派他人）
  useEffect(() => {
    if (!session || session.role === 'admin_staff') return
    const selfId = parseInt(session.sub)
    setAssignments((prev) => {
      if (prev.length === 1 && prev[0].employeeId === null) {
        return [{ ...prev[0], employeeId: selfId }]
      }
      return prev
    })
  }, [session])

  // 預估金額 / 保司 / 險種 / 委託日變動時試算公證費（debounce）
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!estimatedAmount || estimatedAmount <= 0 || !insuranceCompanyId || !insuranceTypeId) {
      setFeeCalc(null)
      return
    }
    debounceRef.current = setTimeout(async () => {
      const res = await api.post<FeeCalcResult>('/api/fee-calc', {
        amount: estimatedAmount,
        insuranceCompanyId,
        insuranceTypeId,
        commissionDate,
      })
      if (res.success && res.data) {
        setFeeCalc(res.data)
        form.setFieldsValue({ estimatedFee: res.data.fee })
      } else {
        setFeeCalc(null)
      }
    }, FEE_CALC_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [estimatedAmount, insuranceCompanyId, insuranceTypeId, commissionDate, form])

  const handleAddAssignment = () => {
    setAssignments((prev) => [...prev, { key: String(Date.now()), employeeId: null, role: '協辦', contributionRatio: 0 }])
  }

  const handleRemoveAssignment = (key: string) => {
    setAssignments((prev) => prev.filter((a) => a.key !== key))
  }

  const handleAssignmentChange = (key: string, field: keyof AssignmentRow, value: unknown) => {
    setAssignments((prev) => prev.map((a) => {
      if (a.key === key) return { ...a, [field]: value }
      // 主辦唯一：某列設為主辦時，其餘自動降為協辦
      if (field === 'role' && value === '主辦' && a.role === '主辦') return { ...a, role: '協辦' }
      return a
    }))
  }

  const handleAddCoInsurer = () => {
    setCoInsurers((prev) => [...prev, { key: String(Date.now()), companyId: null, policyNumber: '', ratio: null }])
  }

  const handleRemoveCoInsurer = (key: string) => {
    setCoInsurers((prev) => prev.filter((c) => c.key !== key))
  }

  const handleCoInsurerChange = (key: string, field: keyof CoInsurerRow, value: unknown) => {
    setCoInsurers((prev) => prev.map((c) => c.key === key ? { ...c, [field]: value } : c))
  }

  const handleSubmit = async (values: Record<string, unknown>) => {
    const totalRatio = assignments.reduce((s, a) => s + (a.contributionRatio ?? 0), 0)
    if (Math.abs(totalRatio - 100) > 0.01) {
      message.error('承辦人貢獻比例合計必須為 100%')
      return
    }
    if (assignments.filter((a) => a.role === '主辦').length !== 1) {
      message.error('承辦人須恰有一位主辦')
      return
    }
    // 共保資訊驗證
    for (let i = 0; i < coInsurers.length; i++) {
      const ci = coInsurers[i]
      if (!ci.policyNumber?.trim()) { message.error(`共保資訊第 ${i + 1} 筆：保單號碼必填`); return }
      if (!ci.ratio) { message.error(`共保資訊第 ${i + 1} 筆：共保比例必填`); return }
    }
    if (coInsurers.length > 0) {
      const coSum = coInsurers.reduce((s, c) => s + (c.ratio || 0), 0)
      if (coSum >= 100) { message.error('共保比例合計已達 100%，主保人須保留比例'); return }
    }

    const selectedType = meta.insuranceTypes.find((t) => t.id === values.insuranceTypeId)

    const body = {
      caseNumber: (values.caseNumber as string)?.trim() || undefined,
      departmentId: values.departmentId ?? session?.departmentId,
      insuranceCompanyId: values.insuranceCompanyId,
      brokerCompanyId: values.brokerCompanyId ?? null,
      insuranceContact: values.insuranceContact,
      policyNumber: values.policyNumber,
      insuredName: values.insuredName,
      incidentLocation: values.incidentLocation,
      incidentDate: dayjs(values.incidentDate as string).toISOString(),
      commissionDate: dayjs(values.commissionDate as string).toISOString(),
      insuranceType: selectedType?.name ?? '',
      incidentCause: values.incidentCause,
      estimatedAmount: values.estimatedAmount ?? null,
      coverageLimit: values.coverageLimit ?? null,
      deductible: values.deductible ?? 0,
      estimatedFee: values.estimatedFee ?? undefined,
      isSpecialCase,
      notes: values.notes,
      parkingStatus: values.parkingStatus ?? null,
      contactFormStatus: values.contactFormStatus,
      contactReturnDate: values.contactReturnDate
        ? dayjs(values.contactReturnDate as string).toISOString()
        : null,
      nasFolder: values.nasFolder,
      coInsurers: coInsurers.map((c) => ({
        companyId: c.companyId,
        policyNumber: c.policyNumber,
        ratio: c.ratio ?? 0,
      })),
      assignments: assignments.filter((a) => a.employeeId).map((a) => ({
        employeeId: a.employeeId!,
        role: a.role,
        contributionRatio: a.contributionRatio / 100,
      })),
    }

    await doCreateCase(body, false)
  }

  const doCreateCase = async (body: Record<string, unknown>, confirmDuplicate: boolean) => {
    setSubmitting(true)
    const res = await api.post<{ id: number; caseNumber: string }>('/api/cases', {
      ...body,
      confirmDuplicate,
    })
    setSubmitting(false)

    if (res.success && res.data) {
      message.success(`案件 ${res.data.caseNumber} 成案成功！`)
      window.dispatchEvent(new Event('nansan:case-updated'))
      router.push(`/cases/${res.data.id}`)
      return
    }

    // FR-80 重複保單防護
    if ((res as { code?: string }).code === 'DUPLICATE_POLICY') {
      Modal.confirm({
        title: '可能重複建檔',
        content: res.error ?? '此保單號碼可能已存在案件，確定仍要新增？',
        okText: '確認新增',
        cancelText: '取消',
        onOk: () => doCreateCase(body, true),
      })
      return
    }

    message.error(res.error ?? '建案失敗')
  }

  const assignmentColumns = [
    {
      title: '承辦人',
      key: 'employee',
      render: (_: unknown, record: AssignmentRow) => (
        <Select
          style={{ width: 150 }}
          value={record.employeeId ?? undefined}
          onChange={(v) => handleAssignmentChange(record.key, 'employeeId', v)}
          placeholder="選擇人員"
          showSearch
          filterOption={(input, opt) => String(opt?.children ?? '').includes(input)}
        >
          {meta.employees.map((e) => <Option key={e.id} value={e.id}>{e.name}</Option>)}
        </Select>
      ),
    },
    {
      title: '角色',
      key: 'role',
      render: (_: unknown, record: AssignmentRow) => (
        <Select
          style={{ width: 100 }}
          value={record.role}
          onChange={(v) => handleAssignmentChange(record.key, 'role', v)}
        >
          <Option value="主辦">主辦</Option>
          <Option value="協辦">協辦</Option>
        </Select>
      ),
    },
    {
      title: '貢獻比例 (%)',
      key: 'ratio',
      render: (_: unknown, record: AssignmentRow) => (
        <InputNumber
          min={0} max={100}
          value={record.contributionRatio}
          onChange={(v) => handleAssignmentChange(record.key, 'contributionRatio', v ?? 0)}
          style={{ width: 100 }}
        />
      ),
    },
    {
      title: '',
      key: 'action',
      render: (_: unknown, record: AssignmentRow) => (
        <Button
          type="text" danger icon={<DeleteOutlined />}
          onClick={() => handleRemoveAssignment(record.key)}
          disabled={assignments.length <= 1}
        />
      ),
    },
  ]

  const coInsurerColumns = [
    {
      title: '共保公司（選填）',
      key: 'company',
      render: (_: unknown, record: CoInsurerRow) => (
        <Select
          style={{ width: 180 }}
          allowClear showSearch placeholder="選填"
          value={record.companyId ?? undefined}
          onChange={(v) => handleCoInsurerChange(record.key, 'companyId', v ?? null)}
          filterOption={(input, opt) => String(opt?.children ?? '').includes(input)}
        >
          {meta.insuranceCompanies.map((ic) => <Option key={ic.id} value={ic.id}>{ic.name}</Option>)}
        </Select>
      ),
    },
    {
      title: '共保保單號碼',
      key: 'policyNumber',
      render: (_: unknown, record: CoInsurerRow) => (
        <Input
          style={{ width: 160 }}
          placeholder="必填"
          value={record.policyNumber}
          status={record.policyNumber === '' ? 'error' : ''}
          onChange={(e) => handleCoInsurerChange(record.key, 'policyNumber', e.target.value)}
        />
      ),
    },
    {
      title: '共保比例 (%)',
      key: 'ratio',
      render: (_: unknown, record: CoInsurerRow) => (
        <InputNumber
          style={{ width: 110 }}
          min={0.01} max={99.99} precision={2} step={5}
          placeholder="必填"
          value={record.ratio ?? undefined}
          status={!record.ratio ? 'error' : ''}
          onChange={(v) => handleCoInsurerChange(record.key, 'ratio', v ?? null)}
        />
      ),
    },
    {
      title: '',
      key: 'action',
      render: (_: unknown, record: CoInsurerRow) => (
        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleRemoveCoInsurer(record.key)} />
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.back()} type="text" />
        <Title level={4} style={{ margin: 0 }}>新增案件</Title>
      </div>

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ deductible: 0, contactFormStatus: '待傳' }}
      >
        {/* departmentId：有部門者由 session 帶入（隱藏保存）；無部門者改於下方欄位下拉選擇 */}
        {session?.departmentId ? <Form.Item name="departmentId" hidden><Input /></Form.Item> : null}

        <Card title="基本資訊" bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={8}>
              <Form.Item label="公證編號" name="caseNumber" extra="留空則由系統自動產生">
                <Input placeholder="留空＝自動產生" maxLength={30} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={8}>
              {session?.departmentId ? (
                <Form.Item label="部門">
                  <Input value={session?.departmentName ?? '—'} readOnly disabled />
                </Form.Item>
              ) : (
                <Form.Item label="部門" name="departmentId" rules={[{ required: true, message: '必填' }]}>
                  <Select
                    placeholder="選擇部門" showSearch optionFilterProp="label"
                    options={meta.departments.map((d) => ({ value: d.id, label: d.name }))}
                  />
                </Form.Item>
              )}
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="委託日期" name="commissionDate" rules={[{ required: true, message: '必填' }]}>
                <DatePicker
                  style={{ width: '100%' }}
                  format="YYYY-MM-DD"
                  disabledDate={(d) => d.isAfter(dayjs())}
                  onChange={(v) => setCommissionDate(v ? v.format('YYYY-MM-DD') : null)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="保險公司" name="insuranceCompanyId" rules={[{ required: true, message: '必填' }]}>
                <Select
                  placeholder="選擇保險公司" showSearch
                  filterOption={(i, o) => String(o?.children ?? '').includes(i)}
                  onChange={(v) => setInsuranceCompanyId(v as number)}
                >
                  {meta.insuranceCompanies.map((ic) => <Option key={ic.id} value={ic.id}>{ic.name}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="保代公司" name="brokerCompanyId">
                <Select placeholder="選擇保代" allowClear showSearch filterOption={(i, o) => String(o?.children ?? '').includes(i)}>
                  {meta.brokerCompanies.map((b) => <Option key={b.id} value={b.id}>{b.name}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="保險公司承辦人" name="insuranceContact" rules={[{ required: true, message: '必填' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="險種" name="insuranceTypeId" rules={[{ required: true, message: '必填' }]}>
                <Select placeholder="選擇險種" onChange={(v) => setInsuranceTypeId(v as number)}>
                  {meta.insuranceTypes.map((t) => <Option key={t.id} value={t.id}>{t.name}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="保單號碼" name="policyNumber" rules={[{ required: true, message: '必填' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="被保險人" name="insuredName" rules={[{ required: true, message: '必填' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="出險日期" name="incidentDate" rules={[{ required: true, message: '必填' }]}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" disabledDate={(d) => d.isAfter(dayjs())} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="出險地點" name="incidentLocation" rules={[{ required: true, message: '必填' }]}>
                <AutoComplete
                  placeholder="選擇或輸入出險地點"
                  allowClear
                  options={meta.incidentLocations.map((l) => ({ value: l.name }))}
                  filterOption={(i, o) => String(o?.value ?? '').toLowerCase().includes(i.toLowerCase())}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="出險原因" name="incidentCause" rules={[{ required: true, message: '必填' }]}>
                <AutoComplete
                  placeholder="選擇或輸入出險原因"
                  allowClear
                  options={meta.incidentCauses.map((c) => ({ value: c.name }))}
                  filterOption={(i, o) => String(o?.value ?? '').toLowerCase().includes(i.toLowerCase())}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="停泊案件狀態" name="parkingStatus">
                <Select allowClear placeholder="無">
                  {PARKING_STATUS.map((s) => <Option key={s} value={s}>{s}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ margin: '8px 0 16px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Text strong>共保資訊</Text>
            <Button
              size="small" type="primary" icon={<PlusOutlined />} onClick={handleAddCoInsurer}
              style={{ background: '#2E86C1', borderColor: '#2E86C1' }}
            >
              新增共保
            </Button>
          </div>
          {coInsurers.length > 0 && (
            <>
              <Table
                dataSource={coInsurers}
                columns={coInsurerColumns}
                rowKey="key"
                pagination={false}
                size="small"
              />
              <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
                主保人剩餘比例：{(100 - coInsurers.reduce((s, c) => s + (c.ratio || 0), 0)).toFixed(2).replace(/\.?0+$/, '')}%
              </div>
            </>
          )}
        </Card>

        <Card title="金額資訊（選填）" bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={8}>
              <Form.Item label="預估金額" name="estimatedAmount">
                <InputNumber
                  style={{ width: '100%' }} min={0} step={100000}
                  formatter={(v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(v: string | undefined) => parseInt(String(v ?? '0').replace(/,/g, ''), 10)}
                  onChange={(v) => setEstimatedAmount(v as number | null)}
                />
              </Form.Item>

              {/* FR-18 公證費試算結果 */}
              {feeCalc && (
                <Card
                  size="small"
                  style={{ background: '#EBF4FC', borderColor: '#2E86C1', marginTop: -8, marginBottom: 12 }}
                >
                  <Text strong style={{ color: '#1B4F8C' }}>
                    預估公證費：${feeCalc.fee.toLocaleString()}
                  </Text>
                  {feeCalc.minApplied && (
                    <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>（低於最低費用，以最低公證費計）</Text>
                  )}
                  <Divider style={{ margin: '8px 0' }} />
                  {feeCalc.bands.map((b, i) => (
                    <Text key={i} type="secondary" style={{ display: 'block', fontSize: 12 }}>
                      {b.range}：${b.amount.toLocaleString()} × {(b.rate * 100).toFixed(2)}% = ${Math.round(b.fee).toLocaleString()}
                    </Text>
                  ))}
                </Card>
              )}
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="預估公證費" name="estimatedFee">
                <InputNumber
                  style={{ width: '100%' }} min={0}
                  formatter={(v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(v: string | undefined) => parseInt(String(v ?? '0').replace(/,/g, ''), 10)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="自負額" name="deductible">
                <InputNumber
                  style={{ width: '100%' }} min={0}
                  formatter={(v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(v: string | undefined) => parseInt(String(v ?? '0').replace(/,/g, ''), 10)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="保額(賠償限額)" name="coverageLimit">
                <InputNumber
                  style={{ width: '100%' }} min={0} step={100000}
                  formatter={(v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                  parser={(v: string | undefined) => parseInt(String(v ?? '0').replace(/,/g, ''), 10)}
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title="其他" bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={12}>
              <Form.Item label="聯絡單狀態" name="contactFormStatus">
                <Select>
                  {CONTACT_FORM_STATUS.map((s) => <Option key={s} value={s}>{s}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="回傳日期" name="contactReturnDate">
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item label="NAS 路徑" name="nasFolder">
                <TextArea
                  placeholder="\\NAS-TP\cases\..."
                  autoSize={{ minRows: 1, maxRows: 3 }}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
              </Form.Item>
            </Col>
            <Col xs={24}>
              {/* FR-89 特殊案件 */}
              <Form.Item>
                <Checkbox checked={isSpecialCase} onChange={(e) => setIsSpecialCase(e.target.checked)}>
                  特殊案件
                </Checkbox>
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>
                  （如：關注案件、極大爭議、複雜度較高或金額較高）
                </Text>
              </Form.Item>
              {isSpecialCase && (
                <Alert
                  type="warning"
                  showIcon
                  message="此案件將標記為特殊案件，送審文件不論金額均須呈送執行副總"
                  style={{ marginTop: -8, marginBottom: 16 }}
                />
              )}
            </Col>
            <Col xs={24}>
              <Form.Item label="備註" name="notes">
                <TextArea rows={3} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card
          title="承辦人指派"
          bordered={false}
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}
          extra={
            <Button size="small" icon={<PlusOutlined />} onClick={handleAddAssignment}>新增承辦人</Button>
          }
        >
          <Table
            dataSource={assignments}
            columns={assignmentColumns}
            rowKey="key"
            pagination={false}
            size="small"
          />
          <div style={{ marginTop: 8, color: '#8c8c8c', fontSize: 12 }}>
            貢獻比例合計：{assignments.reduce((s, a) => s + (a.contributionRatio ?? 0), 0)}%（需合計 100%）
          </div>
        </Card>

        <Divider />
        <Space>
          <Button type="primary" htmlType="submit" loading={submitting} style={{ background: '#1B4F8C' }}>
            建立案件
          </Button>
          <Button onClick={() => router.back()}>取消</Button>
        </Space>
      </Form>
    </div>
  )
}
