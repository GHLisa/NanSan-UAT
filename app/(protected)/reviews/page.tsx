'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card, Table, Tabs, Button, Tag, Typography, Space, Modal, Form, Input, message,
} from 'antd'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title, Text } = Typography
const { TextArea } = Input

interface ReviewItem {
  id: number
  caseId: number
  caseNumber: string
  insuredName: string
  insuranceType: string
  documentType: string
  submitterName: string
  submittedAt: string
  submissionNotes: string | null
  reviewerName: string
  reviewStatus: string
  reviewRemarks: string | null
  reviewedAt: string | null
  requiresVP: boolean
  approvalStatus: string | null
}

export default function ReviewsPage() {
  const router = useRouter()
  const { session } = useAuth()
  const [activeTab, setActiveTab] = useState('reviewer')
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(false)

  const [actionModal, setActionModal] = useState<{ visible: boolean; reviewId: number; action: string; title: string } | null>(null)
  const [remarkForm] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const isVP = session?.role === 'vp'

  const loadReviews = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (activeTab === 'approver') {
      params.set('tab', 'approver')
    } else if (activeTab === 'done') {
      params.set('tab', 'reviewer')
      params.set('status', '已核准')
    } else {
      params.set('tab', 'reviewer')
      params.set('status', '待複核')
    }
    const res = await api.get<ReviewItem[]>(`/api/reviews?${params.toString()}`)
    if (res.success && res.data) setReviews(res.data)
    setLoading(false)
  }, [activeTab])

  useEffect(() => { loadReviews() }, [loadReviews])

  const openAction = (reviewId: number, action: string, title: string) => {
    setActionModal({ visible: true, reviewId, action, title })
    remarkForm.resetFields()
  }

  const handleAction = async (values: { remarks?: string }) => {
    if (!actionModal) return
    setSubmitting(true)
    const res = await api.patch(`/api/reviews/${actionModal.reviewId}`, {
      action: actionModal.action,
      remarks: values.remarks,
    })
    setSubmitting(false)
    if (res.success) {
      message.success('操作成功')
      setActionModal(null)
      loadReviews()
    } else {
      message.error(res.error ?? '操作失敗')
    }
  }

  const baseColumns = [
    {
      title: '案件編號',
      dataIndex: 'caseNumber',
      key: 'caseNumber',
      render: (v: string, r: ReviewItem) => (
        <Button type="link" size="small" onClick={() => router.push(`/cases/${r.caseId}`)}>{v}</Button>
      ),
    },
    { title: '被保人', dataIndex: 'insuredName', key: 'insuredName' },
    { title: '文件類型', dataIndex: 'documentType', key: 'documentType' },
    { title: '送審人', dataIndex: 'submitterName', key: 'submitter' },
    {
      title: '送審時間',
      dataIndex: 'submittedAt',
      key: 'submittedAt',
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm'),
    },
    { title: '送審說明', dataIndex: 'submissionNotes', key: 'notes', render: (v: string | null) => v ?? '-' },
  ]

  const reviewerColumns = [
    ...baseColumns,
    {
      title: '狀態',
      dataIndex: 'reviewStatus',
      key: 'status',
      render: (v: string) => (
        <Tag color={v === '已核准' ? 'green' : v === '退回' ? 'red' : 'orange'}>{v}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, r: ReviewItem) => {
        if (r.reviewStatus !== '待複核') return null
        return (
          <Space>
            <Button size="small" type="primary" style={{ background: '#52c41a', borderColor: '#52c41a' }} onClick={() => openAction(r.id, 'approve', '核准複核')}>核准</Button>
            <Button size="small" danger onClick={() => openAction(r.id, 'reject', '退回複核')}>退回</Button>
          </Space>
        )
      },
    },
  ]

  const approverColumns = [
    ...baseColumns,
    {
      title: '複核狀態',
      dataIndex: 'reviewStatus',
      key: 'reviewStatus',
      render: (v: string) => <Tag color={v === '已核准' ? 'green' : 'orange'}>{v}</Tag>,
    },
    {
      title: '批示狀態',
      dataIndex: 'approvalStatus',
      key: 'approvalStatus',
      render: (v: string | null) => (
        <Tag color={v === '已核准' ? 'green' : v === '退回' ? 'red' : 'default'}>{v ?? '待批示'}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, r: ReviewItem) => {
        if (r.approvalStatus) return <Text type="secondary">已處理</Text>
        return (
          <Space>
            <Button size="small" type="primary" style={{ background: '#52c41a', borderColor: '#52c41a' }} onClick={() => openAction(r.id, 'vp_approve', '副總批准')}>批准</Button>
            <Button size="small" danger onClick={() => openAction(r.id, 'vp_reject', '副總退回')}>退回</Button>
          </Space>
        )
      },
    },
  ]

  const doneColumns = [
    ...baseColumns,
    {
      title: '複核狀態',
      dataIndex: 'reviewStatus',
      key: 'reviewStatus',
      render: (v: string) => <Tag color={v === '已核准' ? 'green' : v === '退回' ? 'red' : 'orange'}>{v}</Tag>,
    },
    {
      title: '複核時間',
      dataIndex: 'reviewedAt',
      key: 'reviewedAt',
      render: (v: string | null) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-',
    },
    { title: '複核意見', dataIndex: 'reviewRemarks', key: 'remarks', render: (v: string | null) => v ?? '-' },
  ]

  const tabItems = [
    {
      key: 'reviewer',
      label: '複核待辦',
      children: (
        <Table
          dataSource={reviews}
          columns={reviewerColumns}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 筆` }}
          scroll={{ x: 1000 }}
        />
      ),
    },
    ...(isVP ? [{
      key: 'approver',
      label: '待執行副總閱',
      children: (
        <Table
          dataSource={reviews}
          columns={approverColumns}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 筆` }}
          scroll={{ x: 1100 }}
        />
      ),
    }] : []),
    {
      key: 'done',
      label: '已完成',
      children: (
        <Table
          dataSource={reviews}
          columns={doneColumns}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 筆` }}
          scroll={{ x: 1000 }}
        />
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 16 }}>文件審核</Title>
      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
        />
      </Card>

      <Modal
        title={actionModal?.title}
        open={actionModal?.visible}
        onCancel={() => setActionModal(null)}
        footer={null}
        destroyOnClose
      >
        <Form form={remarkForm} layout="vertical" onFinish={handleAction}>
          <Form.Item label="意見備註（選填）" name="remarks">
            <TextArea rows={3} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={submitting} style={{ background: '#1B4F8C' }}>確認</Button>
            <Button onClick={() => setActionModal(null)}>取消</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}
