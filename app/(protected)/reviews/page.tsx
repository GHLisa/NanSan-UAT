'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table, Button, Card, Typography, Tabs, Modal, Form, Input, Space, message, Tag,
} from 'antd'
import { CheckOutlined, RollbackOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title, Text } = Typography
const { TextArea } = Input

// ── GateNode ─────────────────────────────────────────────────────────────
const GATE_STYLE: Record<string, React.CSSProperties> = {
  active:   { background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' },
  done:     { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' },
  rejected: { background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' },
  waiting:  { background: '#f9fafb', color: '#9ca3af', border: '1px solid #e5e7eb' },
}
const GATE_ICON: Record<string, string> = { active: ' ●', done: ' ✓', rejected: ' ✗', waiting: '' }

function GateNode({ label, state }: { label: string; state: string }) {
  const s = GATE_STYLE[state] ?? GATE_STYLE.waiting
  return (
    <span style={{ ...s, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {label}{GATE_ICON[state] ?? ''}
    </span>
  )
}

function ReviewGate({ r }: { r: ReviewItem }) {
  const mgrSt = r.reviewStatus === '退回'  ? 'rejected'
              : r.reviewStatus === '待複核' ? 'active'
              : r.reviewStatus === '已核准' ? 'done'
              : 'waiting'

  if (!r.requiresVP) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <GateNode label="主管複核" state={mgrSt} />
      </div>
    )
  }

  if (r.requiresMidApproval) {
    const midSt = mgrSt !== 'done'                         ? 'waiting'
                : r.midApprovalStatus === '已核准'          ? 'done'
                : r.midApprovalStatus === '退回'            ? 'rejected'
                : r.midApprovalStatus === '待副總審核'       ? 'active'
                : 'waiting'
    const vpSt = midSt !== 'done'                          ? 'waiting'
               : r.approvalStatus === '已核准'              ? 'done'
               : r.approvalStatus === '退回'               ? 'rejected'
               : r.approvalStatus === '待執行副總閱'        ? 'active'
               : 'waiting'
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' }}>
        <GateNode label="主管複核" state={mgrSt} />
        <span style={{ color: '#d1d5db', fontSize: 12 }}>→</span>
        <GateNode label="副總審核" state={midSt} />
        <span style={{ color: '#d1d5db', fontSize: 12 }}>→</span>
        <GateNode label="執行副總閱" state={vpSt} />
      </div>
    )
  }

  const vpSt = mgrSt !== 'done'                            ? 'waiting'
             : r.approvalStatus === '已核准'                ? 'done'
             : r.approvalStatus === '退回'                 ? 'rejected'
             : r.approvalStatus === '待執行副總閱'          ? 'active'
             : 'waiting'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' }}>
      <GateNode label="主管複核" state={mgrSt} />
      <span style={{ color: '#d1d5db', fontSize: 12 }}>→</span>
      <GateNode label="執行副總閱" state={vpSt} />
    </div>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────
interface ReviewItem {
  id: number
  caseId: number
  caseNumber: string
  insuredName: string
  documentType: string
  checkedDocuments: string[]
  submittedBy: number
  submitterName: string
  submittedAt: string
  submissionNotes: string | null
  reviewerId: number
  reviewerName: string
  reviewStatus: string
  reviewRemarks: string | null
  reviewedAt: string | null
  requiresVP: boolean
  requiresMidApproval: boolean
  approverId: number | null
  approverName: string | null
  approvalStatus: string | null
  midApproverId: number | null
  midApproverName: string | null
  midApprovalStatus: string | null
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function ReviewsPage() {
  const router = useRouter()
  const { session } = useAuth()
  const role = session?.role ?? ''
  const empId = session ? parseInt(session.sub) : 0

  const isVP = role === 'vp'
  const canApprove = role === 'dept_manager' || role === 'vp'

  const [activeTab, setActiveTab] = useState(isVP ? 'pendingVP' : 'pending')
  const [pendingData, setPendingData]     = useState<ReviewItem[]>([])
  const [pendingVPData, setPendingVPData] = useState<ReviewItem[]>([])
  const [loading, setLoading] = useState(false)

  // Reject modal
  const [rejectModal, setRejectModal] = useState<ReviewItem | null>(null)
  const [rejectForm] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const loadTab = useCallback(async (tab: string) => {
    setLoading(true)
    const res = await api.get<ReviewItem[]>(`/api/reviews?tab=${tab}`)
    if (res.success && res.data) {
      if (tab === 'pending') setPendingData(res.data)
      else setPendingVPData(res.data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadTab('pending')
    if (isVP) loadTab('pendingVP')
  }, [loadTab, isVP])

  // ── Approve ────────────────────────────────────────────────────────────
  async function handleApprove(r: ReviewItem) {
    let action: string
    if (role === 'vp' && r.approvalStatus === '待執行副總閱') {
      action = 'vp_approve'
    } else if (role === 'dept_manager' && r.midApprovalStatus === '待副總審核' && r.midApproverId === empId) {
      action = 'mid_approve'
    } else if (r.reviewStatus === '待複核') {
      action = 'approve'
    } else {
      return
    }

    const res = await api.patch(`/api/reviews/${r.id}`, { action })
    if (res.success) {
      const msgs: Record<string, string> = {
        approve: r.requiresMidApproval ? '複核通過，已送副總審核' : r.requiresVP ? '複核通過，已送執行副總閱示' : '複核通過，審核完成',
        mid_approve: '副總審核通過，已送執行副總閱示',
        vp_approve: '已核准',
      }
      message.success(msgs[action] ?? '操作成功')
      loadTab(activeTab === 'pendingVP' ? 'pendingVP' : 'pending')
      if (isVP) loadTab('pendingVP')
    } else {
      message.error(res.error ?? '操作失敗')
    }
  }

  // ── Reject ─────────────────────────────────────────────────────────────
  function openReject(r: ReviewItem) {
    setRejectModal(r)
    rejectForm.resetFields()
  }

  async function handleReject(values: { rejectReason: string }) {
    if (!rejectModal) return
    setSubmitting(true)

    let action: string
    if (role === 'vp' && rejectModal.approvalStatus === '待執行副總閱') {
      action = 'vp_reject'
    } else if (role === 'dept_manager' && rejectModal.midApprovalStatus === '待副總審核' && rejectModal.midApproverId === empId) {
      action = 'mid_reject'
    } else {
      action = 'reject'
    }

    const res = await api.patch(`/api/reviews/${rejectModal.id}`, { action, remarks: values.rejectReason })
    setSubmitting(false)
    if (res.success) {
      message.success('已退回')
      setRejectModal(null)
      rejectForm.resetFields()
      loadTab(activeTab === 'pendingVP' ? 'pendingVP' : 'pending')
      if (isVP) loadTab('pendingVP')
    } else {
      message.error(res.error ?? '操作失敗')
    }
  }

  // ── Actionable check ───────────────────────────────────────────────────
  function isActionable(r: ReviewItem): boolean {
    if (role === 'vp') return r.approvalStatus === '待執行副總閱'
    if (role === 'dept_manager') {
      return (r.reviewStatus === '待複核') ||
             (r.midApprovalStatus === '待副總審核' && r.midApproverId === empId)
    }
    return false
  }

  // ── Columns ────────────────────────────────────────────────────────────
  const actionCol = canApprove ? [{
    title: '操作', key: 'action', width: 80, fixed: 'right' as const,
    render: (_: unknown, r: ReviewItem) => {
      if (!isActionable(r)) return null
      return (
        <Space size={4} direction="vertical" style={{ width: '100%' }}>
          <Button size="small" type="primary" icon={<CheckOutlined />}
            style={{ background: '#52c41a', borderColor: '#52c41a', width: '100%' }}
            onClick={() => handleApprove(r)}>
            通過
          </Button>
          <Button size="small" type="primary" danger icon={<RollbackOutlined />}
            style={{ width: '100%' }}
            onClick={() => openReject(r)}>
            退回
          </Button>
        </Space>
      )
    },
  }] : []

  const baseColumns = [
    {
      title: '公證編號', dataIndex: 'caseNumber', key: 'caseNumber', width: 160,
      render: (v: string, r: ReviewItem) => (
        <a onClick={() => router.push(`/cases/${r.caseId}`)}
           style={{ color: '#1B4F8C', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {v}
        </a>
      ),
    },
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName', width: 150 },
    { title: '文件類型', dataIndex: 'documentType', key: 'documentType', width: 130 },
    {
      title: '待審文件', key: 'checkedDocuments', width: 180,
      render: (_: unknown, r: ReviewItem) =>
        r.checkedDocuments?.length > 0
          ? <Space size={4} wrap>{r.checkedDocuments.map(t => <Tag key={t} style={{ fontSize: 11, margin: 0 }}>{t}</Tag>)}</Space>
          : <Text type="secondary">—</Text>,
    },
    {
      title: '審核關卡', key: 'gate', width: 260,
      render: (_: unknown, r: ReviewItem) => <ReviewGate r={r} />,
    },
    {
      title: '送審人', dataIndex: 'submitterName', key: 'submitter', width: 80,
    },
    {
      title: '送審時間', dataIndex: 'submittedAt', key: 'submittedAt', width: 100,
      render: (v: string) => dayjs(v).format('MM/DD HH:mm'),
    },
    ...actionCol,
  ]

  // ── Tab items ──────────────────────────────────────────────────────────
  const tabItems = [
    {
      key: 'pending',
      label: `複核待辦（${pendingData.length}）`,
      children: (
        <Table
          dataSource={pendingData}
          columns={baseColumns}
          rowKey="id"
          size="small"
          loading={loading && activeTab === 'pending'}
          scroll={{ x: 970 }}
          sticky={{ offsetHeader: 168 }}
          pagination={{ pageSize: 15, showTotal: n => `共 ${n} 筆` }}
        />
      ),
    },
    {
      key: 'pendingVP',
      label: `待執行副總閱（${pendingVPData.length}）`,
      children: (
        <Table
          dataSource={pendingVPData}
          columns={baseColumns}
          rowKey="id"
          size="small"
          loading={loading && activeTab === 'pendingVP'}
          scroll={{ x: 970 }}
          sticky={{ offsetHeader: 168 }}
          pagination={{ pageSize: 15, showTotal: n => `共 ${n} 筆` }}
        />
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      {/* Sticky 標題 + Tabs */}
      <div style={{ position: 'sticky', top: 64, zIndex: 10, background: '#F5F7FA', paddingBottom: 0, marginBottom: 12 }}>
        <Title level={4} style={{ margin: '0 0 12px 0' }}>文件審核</Title>
        <Card size="small" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            tabBarStyle={{ marginBottom: 0 }}
            items={tabItems.map(t => ({ key: t.key, label: t.label }))}
          />
        </Card>
      </div>

      <Card size="small" style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        {tabItems.find(t => t.key === activeTab)?.children}
      </Card>

      {/* 退回意見 Modal */}
      <Modal
        title="退回意見"
        open={!!rejectModal}
        onCancel={() => { setRejectModal(null); rejectForm.resetFields() }}
        onOk={() => rejectForm.submit()}
        okText="確認退回"
        cancelText="取消"
        okButtonProps={{ danger: true, loading: submitting }}
        destroyOnClose
      >
        <Form form={rejectForm} layout="vertical" onFinish={handleReject} style={{ marginTop: 16 }}>
          <Form.Item name="rejectReason" label="退回原因" rules={[{ required: true, message: '退回原因必填' }]}>
            <TextArea rows={3} placeholder="請說明退回原因及需修正事項..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
