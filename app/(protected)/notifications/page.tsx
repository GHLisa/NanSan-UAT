'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card, List, Button, Typography, Tag, Switch, Space, message, Badge, Empty,
} from 'antd'
import { BellOutlined, CheckOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

dayjs.extend(relativeTime)

const { Title, Text } = Typography

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

const TYPE_COLOR: Record<string, string> = {
  review: 'blue',
  sla: 'orange',
  settlement: 'green',
  case: 'purple',
  system: 'default',
}

export default function NotificationsPage() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)

  const unreadCount = notifications.filter((n) => !n.isRead).length

  const loadNotifications = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (unreadOnly) params.set('unreadOnly', 'true')
    const res = await api.get<NotificationItem[]>(`/api/notifications?${params.toString()}`)
    if (res.success && res.data) setNotifications(res.data)
    setLoading(false)
  }, [unreadOnly])

  useEffect(() => { loadNotifications() }, [loadNotifications])

  const handleMarkAllRead = async () => {
    setMarkingAll(true)
    const res = await api.patch('/api/notifications', {})
    setMarkingAll(false)
    if (res.success) {
      message.success('已全部標為已讀')
      loadNotifications()
    } else {
      message.error(res.error ?? '操作失敗')
    }
  }

  const handleMarkOne = async (id: number) => {
    const res = await api.patch('/api/notifications', { ids: [id] })
    if (res.success) {
      setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n))
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space align="center">
          <Title level={4} style={{ margin: 0 }}>通知中心</Title>
          {unreadCount > 0 && (
            <Badge count={unreadCount} style={{ backgroundColor: '#fa8c16' }} />
          )}
        </Space>
        <Space>
          <Space>
            <Text type="secondary">只看未讀</Text>
            <Switch checked={unreadOnly} onChange={setUnreadOnly} size="small" />
          </Space>
          {unreadCount > 0 && (
            <Button
              icon={<CheckOutlined />}
              loading={markingAll}
              onClick={handleMarkAllRead}
            >
              全部已讀
            </Button>
          )}
        </Space>
      </div>

      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        {notifications.length === 0 && !loading ? (
          <Empty description="沒有通知" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <List
            loading={loading}
            dataSource={notifications}
            renderItem={(item) => (
              <List.Item
                key={item.id}
                style={{
                  background: item.isRead ? 'transparent' : '#EBF4FC',
                  padding: '12px 16px',
                  borderRadius: 4,
                  marginBottom: 4,
                  cursor: item.caseId ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (!item.isRead) handleMarkOne(item.id)
                  if (item.caseId) router.push(`/cases/${item.caseId}`)
                }}
                extra={
                  !item.isRead && (
                    <Button
                      type="text" size="small"
                      onClick={(e) => { e.stopPropagation(); handleMarkOne(item.id) }}
                    >
                      標為已讀
                    </Button>
                  )
                }
              >
                <List.Item.Meta
                  avatar={
                    <div style={{ paddingTop: 4 }}>
                      <BellOutlined style={{ fontSize: 18, color: item.isRead ? '#8c8c8c' : '#1B4F8C' }} />
                    </div>
                  }
                  title={
                    <Space>
                      <Text strong={!item.isRead}>{item.title}</Text>
                      <Tag color={TYPE_COLOR[item.type] ?? 'default'} style={{ fontSize: 11 }}>{item.type}</Tag>
                      {item.caseNumber && <Tag color="blue">{item.caseNumber}</Tag>}
                    </Space>
                  }
                  description={
                    <div>
                      <Text type="secondary" style={{ fontSize: 13 }}>{item.message}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {dayjs(item.createdAt).fromNow()}（{dayjs(item.createdAt).format('YYYY-MM-DD HH:mm')}）
                      </Text>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  )
}
