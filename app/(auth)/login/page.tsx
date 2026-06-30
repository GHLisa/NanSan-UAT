'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Form, Button, Input, Card, Alert, Typography,
} from 'antd'
import { UserOutlined, LockOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import type { RoleInfo } from '@/types'

const { Title, Text } = Typography

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
  mustChangePassword?: boolean
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

    // 首次登入（或被重設密碼）須強制改密，直接導向改密頁；middleware 亦會攔截其他路徑
    if (res.data.mustChangePassword) {
      router.push('/change-password')
      router.refresh()
      return
    }

    // FR-02（v3.2）多角色免選角色：後端已以主要角色簽發 token，登入後一律直接進儀表板，
    // 不再依 requiresRoleSelect 攔截；多角色切換改由 Header 角色下拉選單處理（FR-03）
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1B4F8C 0%, #2E86C1 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* 登入 Card */}
        <Card style={{ borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
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
      </div>
    </div>
  )
}
