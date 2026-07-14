'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, Typography, Table, Select, Input, Button, Tag, message } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'

const { Title, Text } = Typography

interface SettingItem {
  key: string
  value: string
  label: string
  description: string | null
  updatedAt: string
}

export default function SystemSettingsPage() {
  const { session } = useAuth()
  const [rows, setRows] = useState<SettingItem[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<SettingItem[]>('/api/admin/settings')
    if (res.success && res.data) {
      setRows(res.data)
      setDraft(Object.fromEntries(res.data.map(r => [r.key, r.value])))
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const save = async (key: string) => {
    setSavingKey(key)
    const res = await api.put(`/api/admin/settings`, { key, value: draft[key] })
    setSavingKey(null)
    if (res.success) { message.success('已儲存'); load() }
    else message.error(res.error || '儲存失敗，請稍後再試')
  }

  // 非系統管理員：不顯示內容（選單與 API 已限制，此處為前端二次防護）
  if (session && session.role !== 'sysadmin') {
    return (
      <div style={{ padding: 24 }}>
        <Title level={4} style={{ marginTop: 0 }}>系統參數設定</Title>
        <Text type="danger">您沒有權限使用此功能。</Text>
      </div>
    )
  }

  const isYN = (v: string) => v === 'Y' || v === 'N'

  const columns = [
    {
      title: '參數', dataIndex: 'label', width: 220,
      render: (v: string, r: SettingItem) => (
        <div>
          <div style={{ fontWeight: 600 }}>{v}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.key}</Text>
        </div>
      ),
    },
    {
      title: '說明', dataIndex: 'description',
      render: (v: string | null) => v || '—',
    },
    {
      title: '設定值', width: 210,
      render: (_: unknown, r: SettingItem) => {
        const cur = draft[r.key] ?? r.value
        return isYN(r.value) ? (
          <Select
            value={cur}
            style={{ width: 130 }}
            onChange={val => setDraft(d => ({ ...d, [r.key]: val }))}
            options={[{ value: 'Y', label: '啟用 (Y)' }, { value: 'N', label: '停用 (N)' }]}
          />
        ) : (
          <Input
            value={cur}
            style={{ width: 190 }}
            onChange={e => setDraft(d => ({ ...d, [r.key]: e.target.value }))}
          />
        )
      },
    },
    {
      title: '目前狀態', width: 100, align: 'center' as const,
      render: (_: unknown, r: SettingItem) =>
        isYN(r.value)
          ? <Tag color={r.value === 'Y' ? 'green' : 'red'}>{r.value === 'Y' ? '啟用中' : '已停用'}</Tag>
          : '—',
    },
    {
      title: '更新時間', dataIndex: 'updatedAt', width: 150,
      render: (v: string) => dayjs(v).format('YYYY/MM/DD HH:mm'),
    },
    {
      title: '操作', width: 110, align: 'center' as const,
      render: (_: unknown, r: SettingItem) => (
        <Button
          type="primary"
          size="small"
          icon={<SaveOutlined />}
          loading={savingKey === r.key}
          disabled={(draft[r.key] ?? r.value) === r.value}
          onClick={() => save(r.key)}
        >
          儲存
        </Button>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginTop: 0 }}>系統參數設定</Title>
      <Card size="small">
        <Table
          rowKey="key"
          size="small"
          loading={loading}
          dataSource={rows}
          columns={columns}
          pagination={false}
        />
      </Card>
    </div>
  )
}
