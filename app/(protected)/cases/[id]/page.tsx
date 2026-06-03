'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  Card, Tabs, Tag, Button, Typography, Space, Descriptions, Table, Timeline,
  Spin, message, Divider, Modal, Form, Input, InputNumber, DatePicker, Select,
  Row, Col,
} from 'antd'
import { ArrowLeftOutlined, EditOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title, Text } = Typography
const { TextArea } = Input

const STAGES = [
  '進件/建檔', '初步報告', '理算表', '發函', '中間報告',
  '理算說明/協商', '正式結案報告', '請款單填寫', '結案',
]

interface CaseDetail {
  id: number
  caseNumber: string
  status: string
  currentStage: string
  departmentName: string
  insuranceCompanyName: string
  brokerCompanyName: string | null
  insuredName: string
  policyNumber: string
  insuranceType: string
  incidentLocation: string
  incidentDate: string
  commissionDate: string
  incidentCause: string
  estimatedAmount: number | null
  finalAmount: number | null
  actualFee: number | null
  estimatedFee: number | null
  deductible: number | null
  preliminaryReportDate: string | null
  finalReportDate: string | null
  closeDate: string | null
  isSpecialCase: boolean
  notes: string | null
  assignments: { id: number; employeeId: number; employeeName: string; role: string; contributionRatio: number }[]
  progress: { id: number; stage: string; progressDate: string; description: string | null; creatorName: string }[]
  caseNotes: { id: number; noteDate: string; content: string; creatorName: string }[]
  logs: { id: number; changedAt: string; fieldName: string; oldValue: string | null; newValue: string | null; employeeName: string }[]
  reviews: {
    id: number; documentType: string; submitterName: string; submittedAt: string;
    reviewStatus: string; reviewerName: string; reviewedAt: string | null;
    reviewRemarks: string | null; requiresVP: boolean; approvalStatus: string | null;
  }[]
  settlement: {
    reportDate: string; baseFee: number; travelExpense: number; totalFee: number; remarks: string | null;
    splits: { employeeName: string; ratio: number; amount: number }[]
  } | null
}

export default function CaseDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { session } = useAuth()
  const id = params.id as string

  const [caseData, setCaseData] = useState<CaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editField, setEditField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)

  const [progressModal, setProgressModal] = useState(false)
  const [progressForm] = Form.useForm()
  const [noteModal, setNoteModal] = useState(false)
  const [noteForm] = Form.useForm()

  const loadCase = useCallback(async () => {
    const res = await api.get<CaseDetail>(`/api/cases/${id}`)
    if (res.success && res.data) setCaseData(res.data)
    setLoading(false)
  }, [id])

  useEffect(() => { loadCase() }, [loadCase])

  const handleInlineEdit = (field: string, currentValue: unknown) => {
    setEditField(field)
    setEditValue(currentValue)
  }

  const handleInlineSave = async () => {
    if (!editField) return
    setSaving(true)
    const res = await api.patch(`/api/cases/${id}`, { [editField]: editValue })
    setSaving(false)
    if (res.success) {
      message.success('更新成功')
      setEditField(null)
      loadCase()
    } else {
      message.error(res.error ?? '更新失敗')
    }
  }

  const handleStageChange = async (stage: string) => {
    const res = await api.patch(`/api/cases/${id}`, { currentStage: stage })
    if (res.success) {
      message.success(`已更新至「${stage}」`)
      loadCase()
    } else {
      message.error('更新失敗')
    }
  }

  const handleAddProgress = async (values: { stage: string; progressDate: unknown; description: string }) => {
    const res = await api.post(`/api/cases/${id}/progress`, {
      stage: values.stage,
      progressDate: dayjs(values.progressDate as string).toISOString(),
      description: values.description,
    })
    if (res.success) {
      message.success('已新增進度')
      progressForm.resetFields()
      setProgressModal(false)
      loadCase()
    } else {
      message.error(res.error ?? '新增失敗')
    }
  }

  const handleAddNote = async (values: { content: string; noteDate: unknown }) => {
    const res = await api.post(`/api/cases/${id}/notes`, {
      content: values.content,
      noteDate: dayjs(values.noteDate as string).toISOString(),
    })
    if (res.success) {
      message.success('已新增備忘')
      noteForm.resetFields()
      setNoteModal(false)
      loadCase()
    } else {
      message.error(res.error ?? '新增失敗')
    }
  }

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>
  }
  if (!caseData) return <div style={{ padding: 24 }}>找不到案件</div>

  const canEdit = session && ['handler', 'team_lead', 'dept_manager', 'admin_staff', 'sysadmin'].includes(session.role)

  const statusColor = caseData.status === '已決' ? 'green' : caseData.status === '銷案' ? 'default' : 'blue'

  const EditableField = ({
    field, value, type = 'text',
  }: { field: string; label?: string; value: unknown; type?: 'text' | 'number' | 'date' | 'textarea' }) => {
    if (editField === field) {
      return (
        <Space>
          {type === 'number' && (
            <InputNumber value={editValue as number} onChange={(v) => setEditValue(v)} />
          )}
          {type === 'date' && (
            <DatePicker value={editValue ? dayjs(editValue as string) : null} onChange={(d) => setEditValue(d?.toISOString())} />
          )}
          {type === 'textarea' && (
            <TextArea value={editValue as string} onChange={(e) => setEditValue(e.target.value)} rows={3} style={{ width: 300 }} />
          )}
          {type === 'text' && (
            <Input value={editValue as string} onChange={(e) => setEditValue(e.target.value)} />
          )}
          <Button size="small" type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleInlineSave} />
          <Button size="small" icon={<CloseOutlined />} onClick={() => setEditField(null)} />
        </Space>
      )
    }
    return (
      <Space>
        <span>{value !== null && value !== undefined ? String(value) : '-'}</span>
        {canEdit && (
          <Button
            type="text" size="small" icon={<EditOutlined />}
            onClick={() => handleInlineEdit(field, value)}
            style={{ opacity: 0.5 }}
          />
        )}
      </Space>
    )
  }

  const reviewColumns = [
    { title: '文件類型', dataIndex: 'documentType', key: 'docType' },
    { title: '送審人', dataIndex: 'submitterName', key: 'submitter' },
    { title: '送審時間', dataIndex: 'submittedAt', key: 'submittedAt', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '複核人', dataIndex: 'reviewerName', key: 'reviewer' },
    {
      title: '複核狀態', dataIndex: 'reviewStatus', key: 'reviewStatus',
      render: (v: string) => <Tag color={v === '已核准' ? 'green' : v === '退回' ? 'red' : 'orange'}>{v}</Tag>,
    },
    {
      title: '副總批示', dataIndex: 'approvalStatus', key: 'approvalStatus',
      render: (v: string | null, r: { requiresVP: boolean }) =>
        r.requiresVP ? <Tag color={v === '已核准' ? 'green' : v === '退回' ? 'red' : 'default'}>{v ?? '待批示'}</Tag> : <Text type="secondary">不需要</Text>,
    },
  ]

  const tabItems = [
    {
      key: 'info',
      label: '基本資訊',
      children: (
        <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
          <Descriptions.Item label="部門">{caseData.departmentName}</Descriptions.Item>
          <Descriptions.Item label="保險公司">{caseData.insuranceCompanyName}</Descriptions.Item>
          <Descriptions.Item label="保代公司">{caseData.brokerCompanyName ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="險種">{caseData.insuranceType}</Descriptions.Item>
          <Descriptions.Item label="保單號碼">{caseData.policyNumber}</Descriptions.Item>
          <Descriptions.Item label="被保人">{caseData.insuredName}</Descriptions.Item>
          <Descriptions.Item label="出險地點">{caseData.incidentLocation}</Descriptions.Item>
          <Descriptions.Item label="出險日期">{dayjs(caseData.incidentDate).format('YYYY-MM-DD')}</Descriptions.Item>
          <Descriptions.Item label="受任日">{dayjs(caseData.commissionDate).format('YYYY-MM-DD')}</Descriptions.Item>
          <Descriptions.Item label="出險原因">{caseData.incidentCause}</Descriptions.Item>
          <Descriptions.Item label="估計損失">
            <EditableField field="estimatedAmount" label="估計損失" value={caseData.estimatedAmount} type="number" />
          </Descriptions.Item>
          <Descriptions.Item label="核定損失">
            <EditableField field="finalAmount" label="核定損失" value={caseData.finalAmount} type="number" />
          </Descriptions.Item>
          <Descriptions.Item label="實際公證費">
            <EditableField field="actualFee" label="實際公證費" value={caseData.actualFee} type="number" />
          </Descriptions.Item>
          <Descriptions.Item label="初報日期">
            <EditableField field="preliminaryReportDate" label="初報日期" value={caseData.preliminaryReportDate ? dayjs(caseData.preliminaryReportDate).format('YYYY-MM-DD') : null} type="date" />
          </Descriptions.Item>
          <Descriptions.Item label="正報日期">
            <EditableField field="finalReportDate" label="正報日期" value={caseData.finalReportDate ? dayjs(caseData.finalReportDate).format('YYYY-MM-DD') : null} type="date" />
          </Descriptions.Item>
          <Descriptions.Item label="備註" span={2}>
            <EditableField field="notes" label="備註" value={caseData.notes} type="textarea" />
          </Descriptions.Item>
        </Descriptions>
      ),
    },
    {
      key: 'assignments',
      label: '承辦人',
      children: (
        <Table
          dataSource={caseData.assignments}
          rowKey="id"
          size="small"
          pagination={false}
          columns={[
            { title: '人員', dataIndex: 'employeeName' },
            { title: '角色', dataIndex: 'role' },
            { title: '貢獻比例', dataIndex: 'contributionRatio', render: (v: number) => `${v}%` },
          ]}
        />
      ),
    },
    {
      key: 'progress',
      label: '流程進度',
      children: (
        <div>
          {canEdit && (
            <Button
              type="primary" size="small" icon={<EditOutlined />}
              onClick={() => setProgressModal(true)}
              style={{ background: '#1B4F8C', marginBottom: 12 }}
            >
              新增進度
            </Button>
          )}
          <Timeline
            items={caseData.progress.map((p) => ({
              children: (
                <div>
                  <Text strong>{p.stage}</Text>
                  <Text type="secondary" style={{ marginLeft: 8 }}>{dayjs(p.progressDate).format('YYYY-MM-DD')}</Text>
                  <Text type="secondary" style={{ marginLeft: 8 }}>by {p.creatorName}</Text>
                  {p.description && <div>{p.description}</div>}
                </div>
              ),
            }))}
          />
        </div>
      ),
    },
    {
      key: 'reviews',
      label: '送審記錄',
      children: (
        <Table
          dataSource={caseData.reviews}
          columns={reviewColumns}
          rowKey="id"
          size="small"
          pagination={false}
        />
      ),
    },
    {
      key: 'settlement',
      label: '已決資訊',
      children: caseData.settlement ? (
        <div>
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="結算日">{dayjs(caseData.settlement.reportDate).format('YYYY-MM-DD')}</Descriptions.Item>
            <Descriptions.Item label="基本公證費">{caseData.settlement.baseFee.toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="交通費">{caseData.settlement.travelExpense.toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="合計公證費">{caseData.settlement.totalFee.toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="備註" span={2}>{caseData.settlement.remarks ?? '-'}</Descriptions.Item>
          </Descriptions>
          <Divider />
          <Table
            dataSource={caseData.settlement.splits}
            rowKey="employeeName"
            size="small"
            pagination={false}
            columns={[
              { title: '人員', dataIndex: 'employeeName' },
              { title: '比例', dataIndex: 'ratio', render: (v: number) => `${v}%` },
              { title: '金額', dataIndex: 'amount', render: (v: number) => v.toLocaleString() },
            ]}
          />
        </div>
      ) : <Text type="secondary">尚無已決資訊</Text>,
    },
    {
      key: 'notes',
      label: '備忘',
      children: (
        <div>
          {canEdit && (
            <Button
              type="primary" size="small" icon={<EditOutlined />}
              onClick={() => setNoteModal(true)}
              style={{ background: '#1B4F8C', marginBottom: 12 }}
            >
              新增備忘
            </Button>
          )}
          {caseData.caseNotes.length === 0 ? (
            <Text type="secondary">尚無備忘記錄</Text>
          ) : (
            caseData.caseNotes.map((n) => (
              <Card key={n.id} size="small" style={{ marginBottom: 8 }}>
                <div style={{ marginBottom: 4 }}>
                  <Text type="secondary">{dayjs(n.noteDate).format('YYYY-MM-DD')} · {n.creatorName}</Text>
                </div>
                <div>{n.content}</div>
              </Card>
            ))
          )}
        </div>
      ),
    },
    {
      key: 'logs',
      label: '修改記錄',
      children: (
        <Table
          dataSource={caseData.logs}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 20 }}
          columns={[
            { title: '時間', dataIndex: 'changedAt', render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
            { title: '欄位', dataIndex: 'fieldName' },
            { title: '修改前', dataIndex: 'oldValue', render: (v: string | null) => v ?? '-' },
            { title: '修改後', dataIndex: 'newValue', render: (v: string | null) => v ?? '-' },
            { title: '操作人', dataIndex: 'employeeName' },
          ]}
        />
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/cases')} type="text" />
        <Title level={4} style={{ margin: 0 }}>
          {caseData.caseNumber}
        </Title>
        <Tag color={statusColor}>{caseData.status}</Tag>
        {caseData.isSpecialCase && <Tag color="purple">特殊案件</Tag>}
      </div>

      {/* Stage Progress Buttons */}
      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}>
        <Row gutter={[8, 8]}>
          {STAGES.map((stage) => (
            <Col key={stage}>
              <Button
                size="small"
                type={caseData.currentStage === stage ? 'primary' : 'default'}
                onClick={() => canEdit && handleStageChange(stage)}
                style={caseData.currentStage === stage ? { background: '#1B4F8C', borderColor: '#1B4F8C' } : {}}
              >
                {stage}
              </Button>
            </Col>
          ))}
        </Row>
      </Card>

      {/* Tabs */}
      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Tabs items={tabItems} />
      </Card>

      {/* Progress Modal */}
      <Modal
        title="新增流程進度"
        open={progressModal}
        onCancel={() => setProgressModal(false)}
        footer={null}
      >
        <Form form={progressForm} layout="vertical" onFinish={handleAddProgress}>
          <Form.Item label="階段" name="stage" rules={[{ required: true }]}>
            <Select>
              {STAGES.map((s) => <Select.Option key={s} value={s}>{s}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item label="日期" name="progressDate" rules={[{ required: true }]} initialValue={dayjs()}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="說明" name="description">
            <TextArea rows={3} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" style={{ background: '#1B4F8C' }}>新增</Button>
            <Button onClick={() => setProgressModal(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>

      {/* Note Modal */}
      <Modal
        title="新增備忘"
        open={noteModal}
        onCancel={() => setNoteModal(false)}
        footer={null}
      >
        <Form form={noteForm} layout="vertical" onFinish={handleAddNote}>
          <Form.Item label="日期" name="noteDate" rules={[{ required: true }]} initialValue={dayjs()}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="內容" name="content" rules={[{ required: true }]}>
            <TextArea rows={4} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" style={{ background: '#1B4F8C' }}>新增</Button>
            <Button onClick={() => setNoteModal(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}
