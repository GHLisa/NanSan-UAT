'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card, Row, Col, Typography, Tag, Button, Space, Badge, List, Tooltip, message,
} from 'antd'
import { CheckOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import dayjs from 'dayjs'

const { Title, Text } = Typography

// 已移除「SLA 預警」(sla) 與「兩年時效」(statute) 通知類型
const HIDDEN_TYPES = ['sla', 'statute']

const TYPE_COLOR: Record<string, string> = {
  review:            'blue',
  review_submitted:  'blue',
  rejected:          'red',
  review_rejected:   'red',
  approved:          'green',
  review_approved:   'green',
  dispatch:          'purple',
  case_assigned:     'purple',
  system:            'default',
}

const TYPE_LABEL: Record<string, string> = {
  review:            '待審核',
  review_submitted:  '待審核',
  rejected:          '審核退回',
  review_rejected:   '審核退回',
  approved:          '審核通過',
  review_approved:   '審核通過',
  dispatch:          '派案通知',
  case_assigned:     '派案通知',
  system:            '系統',
}

const TYPE_OPTIONS = [
  { value: '', label: '全部類型' },
  { value: 'review',   label: '待審核' },
  { value: 'rejected', label: '審核退回' },
  { value: 'approved', label: '審核通過' },
  { value: 'dispatch', label: '派案通知' },
]

// type 群組：同一 label 的 types 合併篩選
const TYPE_GROUP: Record<string, string[]> = {
  review:   ['review', 'review_submitted'],
  rejected: ['rejected', 'review_rejected'],
  approved: ['approved', 'review_approved'],
  dispatch: ['dispatch', 'case_assigned'],
}

interface NotificationItem {
  id: number
  type: string
  title: string
  message: string
  caseId: number | null
  caseNumber: string | null
  isRead: boolean
  createdAt: string
}

export default function NotificationsPage() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)

  const loadNotifications = useCallback(async () => {
    setLoading(true)
    const res = await api.get<NotificationItem[]>('/api/notifications')
    if (res.success && res.data) {
      setNotifications(res.data.filter(n => !HIDDEN_TYPES.includes(n.type)))
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadNotifications() }, [loadNotifications])

  const unreadCount = useMemo(() => notifications.filter(n => !n.isRead).length, [notifications])

  const visible = useMemo(() => {
    return notifications
      .filter(n => {
        if (filterType) {
          const group = TYPE_GROUP[filterType] ?? [filterType]
          if (!group.includes(n.type)) return false
        }
        if (showUnreadOnly && n.isRead) return false
        return true
      })
      .sort((a, b) => dayjs(b.createdAt).diff(dayjs(a.createdAt)))
  }, [notifications, filterType, showUnreadOnly])

  async function markRead(id: number) {
    const res = await api.patch('/api/notifications', { ids: [id] })
    if (res.success) {
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
    }
  }

  async function markAllRead() {
    const res = await api.patch('/api/notifications', {})
    if (res.success) {
      message.success('已全部標為已讀')
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
    } else {
      message.error(res.error ?? '操作失敗')
    }
  }

  return (
    <div style={{ padding: 24 }}>
      {/* ── 標題列 ── */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Col>
          <Space align="center">
            <Title level={4} style={{ margin: 0 }}>通知中心</Title>
            {unreadCount > 0 && <Badge count={unreadCount} />}
          </Space>
        </Col>
        <Col>
          <Button icon={<CheckCircleOutlined />} onClick={markAllRead}>
            全部標為已讀
          </Button>
        </Col>
      </Row>

      {/* ── 篩選列 ── */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          {TYPE_OPTIONS.map(opt => (
            <Button
              key={opt.value}
              size="small"
              type={filterType === opt.value ? 'primary' : 'default'}
              style={filterType === opt.value ? { background: '#1B4F8C', borderColor: '#1B4F8C' } : {}}
              onClick={() => setFilterType(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
          <Button
            size="small"
            type={showUnreadOnly ? 'primary' : 'default'}
            style={showUnreadOnly ? { background: '#faad14', borderColor: '#faad14' } : {}}
            onClick={() => setShowUnreadOnly(!showUnreadOnly)}
          >
            {showUnreadOnly ? '顯示全部' : '僅顯示未讀'}
          </Button>
        </Space>
      </Card>

      {/* ── 通知清單 ── */}
      <List
        loading={loading}
        dataSource={visible}
        locale={{ emptyText: '目前無通知' }}
        renderItem={n => (
          <Card
            key={n.id}
            size="small"
            style={{
              marginBottom: 8,
              borderLeft: `4px solid ${n.isRead ? '#d9d9d9' : '#1B4F8C'}`,
              background: n.isRead ? '#fafafa' : '#fff',
            }}
          >
            <Row justify="space-between" align="middle">
              <Col flex="1">
                <Space align="center" size={8}>
                  {!n.isRead && <Badge dot />}
                  <Tag
                    color={TYPE_COLOR[n.type] ?? 'default'}
                    style={{ fontSize: 11 }}
                  >
                    {TYPE_LABEL[n.type] ?? n.type}
                  </Tag>
                  <Text strong style={{ fontSize: 14, color: n.isRead ? '#666' : '#1a202c' }}>
                    {n.title}
                  </Text>
                </Space>
                <div style={{ marginTop: 4, fontSize: 13, color: '#666' }}>
                  {n.message}
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {dayjs(n.createdAt).format('YYYY/MM/DD HH:mm')}
                </Text>
              </Col>
              <Col>
                <Space>
                  {n.caseId && (
                    <Button
                      size="small"
                      type="link"
                      onClick={() => router.push(`/cases/${n.caseId}?from=notifications`)}
                    >
                      查看案件
                    </Button>
                  )}
                  {!n.isRead && (
                    <Tooltip title="標為已讀">
                      <Button
                        size="small"
                        type="text"
                        icon={<CheckOutlined />}
                        onClick={() => markRead(n.id)}
                      />
                    </Tooltip>
                  )}
                </Space>
              </Col>
            </Row>
          </Card>
        )}
      />
    </div>
  )
}
