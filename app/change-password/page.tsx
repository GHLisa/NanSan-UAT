'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Form, Button, Input, Card, Alert, Typography } from 'antd'
import { LockOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'

const { Title, Text } = Typography

export default function ChangePasswordPage() {
  const router = useRouter()
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(values: { currentPassword: string; newPassword: string }) {
    setLoading(true)
    setError('')
    const res = await api.post('/api/auth/change-password', {
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    })
    setLoading(false)

    if (!res.success) {
      setError(res.error ?? '變更失敗')
      return
    }
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1B4F8C 0%, #2E86C1 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <Card style={{ width: '100%', maxWidth: 400, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={4} style={{ margin: 0 }}>變更密碼</Title>
          <Text type="secondary">首次登入請設定您的新密碼（至少 8 碼）</Text>
        </div>

        {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}

        <Form form={form} onFinish={handleSubmit} layout="vertical" size="large">
          <Form.Item
            name="currentPassword"
            label="目前密碼"
            rules={[{ required: true, message: '請輸入目前密碼' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="目前密碼（初始為 nansan1234）" autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="新密碼"
            rules={[
              { required: true, message: '請輸入新密碼' },
              { min: 8, message: '新密碼長度至少 8 碼' },
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="新密碼" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="確認新密碼"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '請再次輸入新密碼' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve()
                  return Promise.reject(new Error('兩次輸入的新密碼不一致'))
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="確認新密碼" autoComplete="new-password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary" htmlType="submit" block loading={loading}
              style={{ height: 44, fontSize: 16, background: '#1B4F8C' }}
            >
              確認變更
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
