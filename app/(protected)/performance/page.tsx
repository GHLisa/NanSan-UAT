'use client'

import { useEffect, useState } from 'react'
import { Card, Table, Typography, Select, Space, Button, Modal, Form, InputNumber, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title } = Typography
const YEARS = Array.from({ length: 5 }, (_, i) => dayjs().year() - i)

interface FeeTargetRow {
  id: number
  employeeId: number
  employeeName: string
  year: number
  targetAmount: number
  targetCaseCount: number
  setByName: string
  setAt: string
}

export default function PerformancePage() {
  const { session } = useAuth()
  const [year, setYear] = useState(dayjs().year())
  const [data, setData] = useState<FeeTargetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm()
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([])

  const fetchData = async () => {
    setLoading(true)
    const res = await api.get<FeeTargetRow[]>(`/api/performance?year=${year}`)
    if (res.success && res.data) setData(res.data)
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData() }, [year])

  useEffect(() => {
    api.get<{ employees: { id: number; name: string }[] }>('/api/meta').then((res) => {
      if (res.success && res.data) setEmployees(res.data.employees)
    })
  }, [])

  const canManage = session?.role === 'dept_manager' || session?.role === 'vp' || session?.role === 'sysadmin'

  async function handleSubmit(values: Record<string, unknown>) {
    const res = await api.post('/api/performance', { ...values, year })
    if (res.success) {
      message.success('設定成功')
      setModalOpen(false)
      form.resetFields()
      fetchData()
    } else {
      message.error(res.error ?? '設定失敗')
    }
  }

  const columns = [
    { title: '員工', dataIndex: 'employeeName', key: 'employeeName' },
    { title: '年度', dataIndex: 'year', key: 'year' },
    {
      title: '公證費目標', dataIndex: 'targetAmount', key: 'targetAmount',
      render: (v: number) => `NT$ ${v.toLocaleString()}`,
    },
    { title: '件數目標', dataIndex: 'targetCaseCount', key: 'targetCaseCount', render: (v: number) => `${v} 件` },
    { title: '設定人', dataIndex: 'setByName', key: 'setByName' },
    { title: '設定時間', dataIndex: 'setAt', key: 'setAt', render: (v: string) => dayjs(v).format('YYYY-MM-DD') },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>純公證費業績目標</Title>
        <Space>
          <Select value={year} onChange={setYear} options={YEARS.map((y) => ({ value: y, label: `${y} 年` }))} style={{ width: 100 }} />
          {canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>設定目標</Button>
          )}
        </Space>
      </div>

      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Table columns={columns} dataSource={data} rowKey="id" loading={loading} pagination={false} size="middle" />
      </Card>

      <Modal title="設定業績目標" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="employeeId" label="員工" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={employees.map((e) => ({ value: e.id, label: e.name }))} />
          </Form.Item>
          <Form.Item name="targetAmount" label="公證費目標（元）" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} step={100000} formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} />
          </Form.Item>
          <Form.Item name="targetCaseCount" label="件數目標" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setModalOpen(false)}>取消</Button>
            <Button type="primary" htmlType="submit">確認</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}
