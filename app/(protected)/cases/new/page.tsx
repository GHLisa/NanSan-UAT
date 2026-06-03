'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card, Form, Input, Button, Select, DatePicker, InputNumber,
  Switch, Typography, Space, Divider, message, Row, Col, Table,
} from 'antd'
import { PlusOutlined, DeleteOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import dayjs from 'dayjs'

const { Title } = Typography
const { Option } = Select
const { TextArea } = Input

interface MetaData {
  insuranceCompanies: { id: number; code: string; name: string }[]
  brokerCompanies: { id: number; name: string }[]
  departments: { id: number; name: string }[]
  employees: { id: number; name: string }[]
  insuranceTypes: { name: string }[]
  incidentLocations: { name: string }[]
}

interface AssignmentRow {
  key: string
  employeeId: number | null
  role: string
  contributionRatio: number
}

export default function CaseNewPage() {
  const router = useRouter()
  const [form] = Form.useForm()
  const [meta, setMeta] = useState<MetaData>({
    insuranceCompanies: [],
    brokerCompanies: [],
    departments: [],
    employees: [],
    insuranceTypes: [],
    incidentLocations: [],
  })
  const [assignments, setAssignments] = useState<AssignmentRow[]>([
    { key: '1', employeeId: null, role: '主辦', contributionRatio: 100 },
  ])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    api.get<MetaData>('/api/meta').then((res) => {
      if (res.success && res.data) setMeta(res.data)
    })
  }, [])

  const handleAddAssignment = () => {
    setAssignments((prev) => [...prev, { key: String(Date.now()), employeeId: null, role: '協辦', contributionRatio: 0 }])
  }

  const handleRemoveAssignment = (key: string) => {
    setAssignments((prev) => prev.filter((a) => a.key !== key))
  }

  const handleAssignmentChange = (key: string, field: keyof AssignmentRow, value: unknown) => {
    setAssignments((prev) => prev.map((a) => a.key === key ? { ...a, [field]: value } : a))
  }

  const handleSubmit = async (values: Record<string, unknown>) => {
    const totalRatio = assignments.reduce((s, a) => s + (a.contributionRatio ?? 0), 0)
    if (Math.abs(totalRatio - 100) > 0.01) {
      message.error('承辦人貢獻比例合計必須為 100%')
      return
    }
    const hasMain = assignments.some((a) => a.role === '主辦')
    if (!hasMain) {
      message.error('至少需要一位主辦人')
      return
    }

    setSubmitting(true)
    const body = {
      departmentId: values.departmentId,
      insuranceCompanyId: values.insuranceCompanyId,
      brokerCompanyId: values.brokerCompanyId ?? null,
      insuranceContact: values.insuranceContact,
      policyNumber: values.policyNumber,
      insuredName: values.insuredName,
      incidentLocation: values.incidentLocation,
      incidentDate: dayjs(values.incidentDate as string).toISOString(),
      commissionDate: dayjs(values.commissionDate as string).toISOString(),
      insuranceType: values.insuranceType,
      incidentCause: values.incidentCause,
      estimatedAmount: values.estimatedAmount ?? null,
      deductible: values.deductible ?? 0,
      isSpecialCase: values.isSpecialCase ?? false,
      notes: values.notes,
      assignments: assignments.filter((a) => a.employeeId).map((a) => ({
        employeeId: a.employeeId!,
        role: a.role,
        contributionRatio: a.contributionRatio,
      })),
    }

    const res = await api.post<{ id: number; caseNumber: string }>('/api/cases', body)
    setSubmitting(false)
    if (res.success && res.data) {
      message.success(`案件 ${res.data.caseNumber} 建立成功`)
      router.push(`/cases/${res.data.id}`)
    } else {
      message.error(res.error ?? '建案失敗')
    }
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

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.back()} type="text" />
        <Title level={4} style={{ margin: 0 }}>新增案件</Title>
      </div>

      <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ isSpecialCase: false, deductible: 0 }}>
        <Card title="基本資訊" bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={8}>
              <Form.Item label="部門" name="departmentId" rules={[{ required: true, message: '必填' }]}>
                <Select placeholder="選擇部門">
                  {meta.departments.map((d) => <Option key={d.id} value={d.id}>{d.name}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="受任日" name="commissionDate" rules={[{ required: true, message: '必填' }]}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="保險公司" name="insuranceCompanyId" rules={[{ required: true, message: '必填' }]}>
                <Select placeholder="選擇保險公司" showSearch filterOption={(i, o) => String(o?.children ?? '').includes(i)}>
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
              <Form.Item label="險種" name="insuranceType" rules={[{ required: true, message: '必填' }]}>
                <Select placeholder="選擇險種">
                  {meta.insuranceTypes.map((t) => <Option key={t.name} value={t.name}>{t.name}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="保單號碼" name="policyNumber" rules={[{ required: true, message: '必填' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="被保人" name="insuredName" rules={[{ required: true, message: '必填' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="出險日期" name="incidentDate" rules={[{ required: true, message: '必填' }]}>
                <DatePicker style={{ width: '100%' }} format="YYYY-MM-DD" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="出險地點" name="incidentLocation" rules={[{ required: true, message: '必填' }]}>
                <Select placeholder="選擇出險地點" showSearch filterOption={(i, o) => String(o?.children ?? '').includes(i)}>
                  {meta.incidentLocations.map((l) => <Option key={l.name} value={l.name}>{l.name}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item label="出險原因" name="incidentCause" rules={[{ required: true, message: '必填' }]}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title="損失資訊（選填）" bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={8}>
              <Form.Item label="估計損失金額" name="estimatedAmount">
                <InputNumber style={{ width: '100%' }} min={0} step={100000} formatter={(v) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={(v: string | undefined) => parseInt(String(v ?? '0').replace(/,/g, ''), 10)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="免賠額" name="deductible">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="保險窗口" name="insuranceContact">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={8}>
              <Form.Item label="特殊案件" name="isSpecialCase" valuePropName="checked">
                <Switch />
              </Form.Item>
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
