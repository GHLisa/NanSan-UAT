'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Table, Card, Row, Col, Typography, Tag, Space, Input, Select, Button, Tooltip, Modal, Descriptions, Spin, Empty, DatePicker, message } from 'antd'
import { ReloadOutlined, SearchOutlined, FileSearchOutlined, SendOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { api } from '@/lib/api'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

const CATEGORY_LABEL: Record<string, string> = {
  new_assignment: '新派案',
  review_submitted: '文件送審',
  review_cascade: '進入下一關',
  review_rejected: '文件退回',
  daily_handler_digest: '每日承辦彙整',
  daily_group_digest: '每日組長彙整',
  daily_reviewer_digest: '每日待審彙整',
  weekly_dept_report: '每週部門報表',
  event_digest: '案件待辦彙整',
  test: '測試',
  other: '其他',
}
const STATUS_LABEL: Record<string, string> = { sent: '已送出', skipped: '略過', failed: '失敗' }
const STATUS_COLOR: Record<string, string> = { sent: 'green', skipped: 'default', failed: 'red' }

interface MailLogItem {
  id: number
  createdAt: string
  category: string
  subject: string
  recipients: string
  status: string
  sentCount: number
  skippedCount: number
  caseId: number | null
  caseNumber: string | null
  error: string | null
}

// 明細含內文
interface MailLogDetail extends MailLogItem {
  bodyHtml: string | null
}

export default function MailLogsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<MailLogItem[]>([])
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<string>('')
  // [2026/07/14] - Lisa - 發信日期區間查詢，預設今天，避免載入過多資料
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>([dayjs(), dayjs()])

  // 明細 Modal
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<MailLogDetail | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (q.trim()) params.set('q', q.trim())
    if (status) params.set('status', status)
    // 以瀏覽器本地時區界定當日起訖，轉 ISO 傳後端（避免 UTC 位移造成日期偏移）
    if (dateRange?.[0] && dateRange?.[1]) {
      params.set('from', dateRange[0].startOf('day').toISOString())
      params.set('to', dateRange[1].endOf('day').toISOString())
    }
    const res = await api.get<MailLogItem[]>(`/api/admin/mail-logs${params.toString() ? `?${params}` : ''}`)
    if (res.success && res.data) setRows(res.data)
    setLoading(false)
  }, [q, status, dateRange])

  useEffect(() => { load() }, [load])

  const openDetail = useCallback(async (id: number) => {
    setDetailOpen(true)
    setDetail(null)
    setDetailLoading(true)
    const res = await api.get<MailLogDetail>(`/api/admin/mail-logs/${id}`)
    if (res.success && res.data) setDetail(res.data)
    setDetailLoading(false)
  }, [])

  // [2026/07/15] - Lisa - 人工補寄：依原收件人與內文重寄，並產生新的發信紀錄
  const [resendingId, setResendingId] = useState<number | null>(null)
  const handleResend = useCallback((id: number, recipients: string) => {
    Modal.confirm({
      title: '確認重寄這封信？',
      content: (
        <div style={{ fontSize: 13 }}>
          <p style={{ margin: '4px 0' }}>將依原收件人與內文重新寄送，並於發信紀錄新增一筆寄送結果。</p>
          <p style={{ margin: '4px 0', color: '#888', wordBreak: 'break-all' }}>收件人：{recipients || '—'}</p>
        </div>
      ),
      okText: '重寄',
      cancelText: '取消',
      onOk: async () => {
        setResendingId(id)
        const res = await api.post<{ sent: number; skipped: number }>(`/api/admin/mail-logs/${id}/resend`, {})
        setResendingId(null)
        if (res.success) {
          message.success('已重新寄送')
          setDetailOpen(false)
          load()
        } else {
          message.error(res.error || '重寄失敗，請稍後再試')
        }
      },
    })
  }, [load])

  const columns = [
    {
      title: '時間', dataIndex: 'createdAt', width: 150,
      render: (v: string) => dayjs(v).format('YYYY/MM/DD HH:mm'),
    },
    {
      title: '類別', dataIndex: 'category', width: 110,
      render: (v: string) => CATEGORY_LABEL[v] ?? v,
    },
    { title: '主旨', dataIndex: 'subject', ellipsis: true },
    {
      title: '收件人', dataIndex: 'recipients', ellipsis: true,
      render: (v: string) => <Tooltip title={v}><span>{v || '—'}</span></Tooltip>,
    },
    {
      title: '案號', dataIndex: 'caseNumber', width: 130,
      render: (v: string | null, r: MailLogItem) =>
        v
          ? (r.caseId
              ? <a style={{ color: '#1B4F8C' }} onClick={() => router.push(`/cases/${r.caseId}`)}>{v}</a>
              : v)
          : '—',
    },
    {
      title: '狀態', dataIndex: 'status', width: 90,
      render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'}>{STATUS_LABEL[v] ?? v}</Tag>,
    },
    {
      title: '送出/略過', width: 100, align: 'center' as const,
      render: (_: unknown, r: MailLogItem) => `${r.sentCount} / ${r.skippedCount}`,
    },
    {
      title: '錯誤/備註', dataIndex: 'error', ellipsis: true,
      render: (v: string | null) => v ? <Tooltip title={v}><Text type="danger" style={{ fontSize: 12 }}>{v}</Text></Tooltip> : '—',
    },
    {
      title: '操作', width: 150, fixed: 'right' as const, align: 'left' as const,
      render: (_: unknown, r: MailLogItem) => (
        <Space size={0}>
          <Button size="small" type="link" icon={<FileSearchOutlined />} onClick={() => openDetail(r.id)}>
            詳細
          </Button>
          <Button
            size="small"
            type="link"
            icon={<SendOutlined />}
            loading={resendingId === r.id}
            onClick={() => handleResend(r.id, r.recipients)}
          >
            重寄
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <div className="page-container" style={{ padding: 24 }}>
      <Title level={4} style={{ margin: '0 0 16px' }}>發信紀錄</Title>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} sm={12} md={8}>
            <Input
              allowClear prefix={<SearchOutlined />}
              placeholder="搜尋主旨 / 收件人 / 案號"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onPressEnter={load}
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <RangePicker
              style={{ width: '100%' }}
              value={dateRange}
              onChange={(v) => setDateRange(v as [Dayjs, Dayjs] | null)}
              format="YYYY/MM/DD"
              allowClear
              placeholder={['起始日期', '結束日期']}
            />
          </Col>
          <Col xs={16} sm={8} md={4}>
            <Select
              style={{ width: '100%' }}
              value={status}
              onChange={setStatus}
              options={[
                { value: '', label: '全部狀態' },
                { value: 'sent', label: '已送出' },
                { value: 'skipped', label: '略過' },
                { value: 'failed', label: '失敗' },
              ]}
            />
          </Col>
          <Col xs={8} sm={4} md={4}>
            <Button icon={<ReloadOutlined />} onClick={load}>查詢</Button>
          </Col>
        </Row>
      </Card>

      <Card size="small">
        <Space style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>共 {rows.length} 筆（最多顯示最新 500 筆）</Text>
        </Space>
        <Table
          dataSource={rows}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 1000 }}
        />
      </Card>

      <Modal
        title="發信紀錄明細"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={
          <Space>
            {detail && (
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={resendingId === detail.id}
                onClick={() => handleResend(detail.id, detail.recipients)}
              >
                重寄
              </Button>
            )}
            <Button onClick={() => setDetailOpen(false)}>關閉</Button>
          </Space>
        }
        width={760}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div>
        ) : detail ? (
          <>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="時間" span={2}>
                {dayjs(detail.createdAt).format('YYYY/MM/DD HH:mm:ss')}
              </Descriptions.Item>
              <Descriptions.Item label="類別">{CATEGORY_LABEL[detail.category] ?? detail.category}</Descriptions.Item>
              <Descriptions.Item label="狀態">
                <Tag color={STATUS_COLOR[detail.status] ?? 'default'}>{STATUS_LABEL[detail.status] ?? detail.status}</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>送出 {detail.sentCount} / 略過 {detail.skippedCount}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="主旨" span={2}>{detail.subject}</Descriptions.Item>
              <Descriptions.Item label="收件人" span={2}>
                <span style={{ wordBreak: 'break-all' }}>{detail.recipients || '—'}</span>
              </Descriptions.Item>
              <Descriptions.Item label="案號" span={2}>
                {detail.caseNumber
                  ? (detail.caseId
                      ? <a style={{ color: '#1B4F8C' }} onClick={() => { setDetailOpen(false); router.push(`/cases/${detail.caseId}`) }}>{detail.caseNumber}</a>
                      : detail.caseNumber)
                  : '—'}
              </Descriptions.Item>
              {detail.error && (
                <Descriptions.Item label="錯誤/備註" span={2}>
                  <Text type="danger">{detail.error}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            <Text strong style={{ display: 'block', marginBottom: 8 }}>信件內文</Text>
            {detail.bodyHtml ? (
              <iframe
                title="mail-body"
                sandbox=""
                srcDoc={detail.bodyHtml}
                style={{ width: '100%', height: 360, border: '1px solid #eee', borderRadius: 4, background: '#fff' }}
              />
            ) : (
              <Empty description="此筆紀錄無內文（早期紀錄未保存內文）" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </>
        ) : (
          <Empty description="查無資料" />
        )}
      </Modal>
    </div>
  )
}
