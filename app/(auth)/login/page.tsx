'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Form, Button, Input, Card, Alert, Typography,
  Divider, Tag, Space, Table,
} from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import type { RoleInfo } from '@/types'

const { Title, Text } = Typography

const TEST_ACCOUNTS = [
  { username: 'handler01', name: '王小明', label: '承辦人 — 台北工程部（一組）', password: 'nansan1234' },
  { username: 'handler02', name: '陳志遠', label: '承辦人 — 台北責任險部（二組）', password: 'nansan1234' },
  { username: 'teamlead01', name: '林組長', label: '組長 — 台北工程部（一組）', password: 'nansan1234' },
  { username: 'manager01', name: '張主管', label: '部門主管 — 台北工程部', password: 'nansan1234' },
  { username: 'vp01', name: '吳哲旭', label: '執行副總', password: 'nansan1234' },
  { username: 'admin01', name: '周行政', label: '行政人員 — 台北工程部', password: 'nansan1234' },
  { username: 'multi01', name: '多角色測試', label: '承辦人 ×2 — 台北工程部＋高雄工程部（多角色示範）', password: 'nansan1234' },
  { username: 'handler05', name: '鄭雅玲', label: '承辦人 — 台北火險部', password: 'nansan1234' },
  { username: 'manager03', name: '林光輝', label: '部門主管 — 台北火險部', password: 'nansan1234' },
  { username: 'manager05', name: '李建明', label: '部門主管 — 高雄工程部（加簽審核）', password: 'nansan1234' },
  { username: 'sysadmin', name: '系統管理員', label: '系統管理員', password: 'nansan1234' },
]

interface LoginData {
  id: number
  name: string
  username: string
  role: string
  roleName: string
  departmentId: number | null
  departmentName: string | null
  allRoles: RoleInfo[]
  requiresRoleSelect: boolean
}

export default function LoginPage() {
  const router = useRouter()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(values: { username: string; password: string }) {
    setLoading(true)
    setError('')
    const res = await api.post<LoginData>('/api/auth/login', values)
    setLoading(false)

    if (!res.success || !res.data) {
      setError(res.error ?? '登入失敗')
      return
    }

    // FR-02（v3.2）多角色免選角色：後端已以主要角色簽發 token，登入後一律直接進儀表板，
    // 不再依 requiresRoleSelect 攔截；多角色切換改由 Header 角色下拉選單處理（FR-03）
    router.push('/dashboard')
    router.refresh()
  }

  const columns = [
    { title: '姓名', dataIndex: 'name', key: 'name', render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span> },
    { title: '角色說明', dataIndex: 'label', key: 'label' },
  ]

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1B4F8C 0%, #2E86C1 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 900, display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        {/* 登入 Card */}
        <Card style={{ flex: '0 0 360px', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{
              width: 64, height: 64, background: '#1B4F8C', borderRadius: 16,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
            }}>
              <span style={{ color: '#fff', fontSize: 28, fontWeight: 900 }}>南</span>
            </div>
            <Title level={4} style={{ margin: 0 }}>南山公證</Title>
            <Text type="secondary">案件管理系統</Text>
          </div>

          {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}

          <Form form={form} onFinish={handleLogin} layout="vertical" size="large">
            <Form.Item name="username" rules={[{ required: true, message: '請輸入帳號' }]}>
              <Input prefix={<UserOutlined />} placeholder="帳號" autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '請輸入密碼' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密碼" autoComplete="current-password" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary" htmlType="submit" block loading={loading}
                style={{ height: 44, fontSize: 16, background: '#1B4F8C' }}
              >
                登入
              </Button>
            </Form.Item>
          </Form>
        </Card>

        {/* 測試帳號說明 Card */}
        <Card
          title="測試帳號列表（密碼均為 nansan1234）"
          style={{ flex: 1, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
          size="small"
        >
          <Table
            dataSource={TEST_ACCOUNTS}
            columns={columns}
            rowKey="username"
            pagination={false}
            size="small"
            onRow={(record) => ({
              style: { cursor: 'pointer' },
              onClick: () => {
                form.setFieldsValue({ username: record.username, password: record.password })
                setError('')
              },
            })}
          />
          <Divider style={{ margin: '12px 0' }} />
          <Space size={4} wrap>
            <Tag color="blue">點擊列自動填入帳號密碼</Tag>
            <Tag color="orange">multi01 多角色（登入後於 Header 切換角色）</Tag>
          </Space>
        </Card>
      </div>
    </div>
  )
}
