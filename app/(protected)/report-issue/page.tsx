'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table, Button, Card, Typography, Tabs, Modal, Form, DatePicker, Input, Select, Space, message, Tag,
} from 'antd'
import { PrinterOutlined, RollbackOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { DOCUMENT_TYPES } from '@/lib/approvalFlow'
import dayjs, { type Dayjs } from 'dayjs'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

// ── Types ─────────────────────────────────────────────────────────────────
interface ReportIssueItem {
  id: number
  caseId: number
  caseNumber: string
  insuredName: string
  departmentName: string
  documentType: string
  submitterName: string
  finalApproverName: string | null
  lastApprovedAt: string | null
  reportIssuedAt: string | null
  reportIssuerName: string | null
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function ReportIssuePage() {
  const router = useRouter()

  const [activeTab, setActiveTab] = useState<'pending' | 'issued'>('pending')
  const [docType, setDocType] = useState<string | undefined>(undefined)
  const [keyword, setKeyword] = useState('')
  // 已出具報告出具日期區間：預設當年度，避免歷年資料一次載入造成負擔（僅套用「已出具」分頁）
  const [issuedRange, setIssuedRange] = useState<[Dayjs, Dayjs] | null>(
    [dayjs().startOf('year'), dayjs().endOf('year')],
  )
  const [pendingData, setPendingData] = useState<ReportIssueItem[]>([])
  const [issuedData, setIssuedData] = useState<ReportIssueItem[]>([])
  const [loading, setLoading] = useState(false)

  // 出具日期登錄 Modal
  const [issueModal, setIssueModal] = useState<ReportIssueItem | null>(null)
  const [issueForm] = Form.useForm<{ reportIssuedDate: Dayjs }>()
  const [submitting, setSubmitting] = useState(false)

  const loadTab = useCallback(async (
    tab: 'pending' | 'issued', dt?: string, kw?: string, range?: [Dayjs, Dayjs] | null,
  ) => {
    setLoading(true)
    const qs = new URLSearchParams({ tab })
    if (dt) qs.set('documentType', dt)
    if (kw) qs.set('keyword', kw)
    // 出具日期區間僅套用於「已出具」分頁
    if (tab === 'issued' && range && range[0] && range[1]) {
      qs.set('dateFrom', range[0].format('YYYY-MM-DD'))
      qs.set('dateTo', range[1].format('YYYY-MM-DD'))
    }
    const res = await api.get<ReportIssueItem[]>(`/api/report-issue?${qs.toString()}`)
    if (res.success && res.data) {
      if (tab === 'pending') setPendingData(res.data)
      else setIssuedData(res.data)
    } else {
      message.error(res.error ?? '載入失敗')
    }
    setLoading(false)
  }, [])

  const reload = useCallback(() => {
    loadTab('pending', docType, keyword)
    loadTab('issued', docType, keyword, issuedRange)
  }, [loadTab, docType, keyword, issuedRange])

  useEffect(() => {
    reload()
  }, [reload])

  // ── 登錄出具報告日期 ──────────────────────────────────────────────────
  function openIssue(r: ReportIssueItem) {
    setIssueModal(r)
    issueForm.setFieldsValue({ reportIssuedDate: dayjs() })
  }

  async function handleIssue(values: { reportIssuedDate: Dayjs }) {
    if (!issueModal) return
    setSubmitting(true)
    const res = await api.patch(`/api/report-issue/${issueModal.id}`, {
      reportIssuedDate: values.reportIssuedDate.format('YYYY-MM-DD'),
    })
    setSubmitting(false)
    if (res.success) {
      message.success('已登錄出具報告日期')
      setIssueModal(null)
      issueForm.resetFields()
      reload()
    } else {
      message.error(res.error ?? '操作失敗')
    }
  }

  // ── 取消出具（清除日期）──────────────────────────────────────────────
  function handleCancelIssue(r: ReportIssueItem) {
    Modal.confirm({
      title: '取消出具報告',
      content: `確定取消「${r.caseNumber} — ${r.documentType}」的出具報告日期？此文件將回到待出具清單。`,
      okText: '確認取消',
      cancelText: '返回',
      okButtonProps: { danger: true },
      async onOk() {
        const res = await api.patch(`/api/report-issue/${r.id}`, { reportIssuedDate: null })
        if (res.success) {
          message.success('已取消出具報告')
          reload()
        } else {
          message.error(res.error ?? '操作失敗')
        }
      },
    })
  }

  // ── Columns ────────────────────────────────────────────────────────────
  const caseNumberCol = {
    title: '公證編號', dataIndex: 'caseNumber', key: 'caseNumber', width: 120,
    render: (v: string, r: ReportIssueItem) => (
      <a onClick={() => router.push(`/cases/${r.caseId}?from=report-issue`)}
         style={{ color: '#1B4F8C', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        {v}
      </a>
    ),
  }
  const commonCols = [
    caseNumberCol,
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName', width: 140 },
    { title: '部門', dataIndex: 'departmentName', key: 'departmentName', width: 110 },
    {
      title: '文件類型', dataIndex: 'documentType', key: 'documentType', width: 150,
      render: (v: string) => <Tag color="blue" style={{ margin: 0 }}>{v}</Tag>,
    },
    {
      title: '最後簽核通過時間', dataIndex: 'lastApprovedAt', key: 'lastApprovedAt', width: 150,
      render: (v: string | null) =>
        v ? dayjs(v).format('YYYY/MM/DD HH:mm') : <Text type="secondary">—</Text>,
    },
    { title: '簽核人', dataIndex: 'finalApproverName', key: 'finalApproverName', width: 90,
      render: (v: string | null) => v ?? <Text type="secondary">—</Text> },
  ]

  const pendingColumns = [
    ...commonCols,
    {
      title: '出具報告日', key: 'action', width: 130, fixed: 'right' as const,
      render: (_: unknown, r: ReportIssueItem) => (
        <Button size="small" type="primary" icon={<PrinterOutlined />}
          style={{ background: '#1B4F8C', borderColor: '#1B4F8C' }}
          onClick={() => openIssue(r)}>
          登錄
        </Button>
      ),
    },
  ]

  const issuedColumns = [
    ...commonCols,
    {
      title: '出具報告日', dataIndex: 'reportIssuedAt', key: 'reportIssuedAt', width: 130,
      render: (v: string | null) =>
        v ? <Text strong style={{ color: '#15803d' }}>{dayjs(v).format('YYYY/MM/DD')}</Text> : '—',
    },
    { title: '出具登錄人', dataIndex: 'reportIssuerName', key: 'reportIssuerName', width: 100,
      render: (v: string | null) => v ?? <Text type="secondary">—</Text> },
    {
      title: '操作', key: 'action', width: 100, fixed: 'right' as const,
      render: (_: unknown, r: ReportIssueItem) => (
        <Button size="small" danger icon={<RollbackOutlined />} onClick={() => handleCancelIssue(r)}>
          取消出具
        </Button>
      ),
    },
  ]

  const tabItems = [
    {
      key: 'pending',
      label: `待出具報告（${pendingData.length}）`,
      children: (
        <Table
          dataSource={pendingData} columns={pendingColumns} rowKey="id" size="small"
          loading={loading && activeTab === 'pending'} scroll={{ x: 890 }}
          sticky={{ offsetHeader: 168 }}
          pagination={{ pageSize: 15, showTotal: (n) => `共 ${n} 筆` }}
        />
      ),
    },
    {
      key: 'issued',
      label: `已出具報告（${issuedData.length}）`,
      children: (
        <Table
          dataSource={issuedData} columns={issuedColumns} rowKey="id" size="small"
          loading={loading && activeTab === 'issued'} scroll={{ x: 890 }}
          sticky={{ offsetHeader: 168 }}
          pagination={{ pageSize: 15, showTotal: (n) => `共 ${n} 筆` }}
        />
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      {/* Sticky 標題 + Tabs + 篩選 */}
      <div style={{ position: 'sticky', top: 64, zIndex: 10, background: '#F5F7FA', paddingBottom: 0, marginBottom: 12 }}>
        <Title level={4} style={{ margin: '0 0 12px 0' }}>出具報告</Title>
        <Card size="small" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <Space wrap style={{ marginBottom: 8 }}>
            <Select
              allowClear placeholder="文件類型" style={{ width: 180 }}
              value={docType} onChange={(v) => setDocType(v)}
              options={DOCUMENT_TYPES.map((t) => ({ value: t, label: t }))}
            />
            <Input.Search
              placeholder="公證編號 / 被保險人" allowClear style={{ width: 220 }}
              onSearch={(v) => setKeyword(v.trim())}
            />
            {activeTab === 'issued' && (
              <RangePicker
                value={issuedRange}
                onChange={(v) => setIssuedRange(v as [Dayjs, Dayjs] | null)}
                format="YYYY/MM/DD"
                allowClear
                style={{ width: 260 }}
                placeholder={['出具起日', '出具訖日']}
              />
            )}
          </Space>
          <Tabs
            activeKey={activeTab}
            onChange={(k) => setActiveTab(k as 'pending' | 'issued')}
            tabBarStyle={{ marginBottom: 0 }}
            items={tabItems.map((t) => ({ key: t.key, label: t.label }))}
          />
        </Card>
      </div>

      <Card size="small" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        {tabItems.find((t) => t.key === activeTab)?.children}
      </Card>

      {/* 登錄出具報告日期 Modal */}
      <Modal
        title="登錄出具報告日期"
        open={!!issueModal}
        onCancel={() => { setIssueModal(null); issueForm.resetFields() }}
        onOk={() => issueForm.submit()}
        okText="確認出具"
        cancelText="取消"
        okButtonProps={{ loading: submitting }}
        destroyOnClose
      >
        {issueModal && (
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary">
              {issueModal.caseNumber}　{issueModal.insuredName}
              <Tag color="blue" style={{ margin: 0 }}>{issueModal.documentType}</Tag>
            </Text>
          </div>
        )}
        <Form form={issueForm} layout="vertical" onFinish={handleIssue}>
          <Form.Item
            name="reportIssuedDate" label="出具報告日期"
            rules={[{ required: true, message: '請選擇出具報告日期' }]}
          >
            <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" placeholder="選擇出具日期" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
