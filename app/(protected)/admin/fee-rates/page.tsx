'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Card, Table, Tabs, Button, Modal, Form, Input, InputNumber, DatePicker,
  Select, Typography, Space, message, Popconfirm,
} from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import dayjs from 'dayjs'

const { Title } = Typography
const { Option } = Select

interface FeeRate {
  id: number
  companyCode: string
  companyName: string
  debitNoteType: string
  minFee: number
  rateBands: string
  effectiveDate: string
  // engineering
  insuranceType?: string
  subRate?: string | null
  mealExpense?: number
  accommodationExpense?: number
  photoFee?: number
  // fire
  remarks?: string | null
}

interface InsuranceCompany {
  id: number
  code: string
  name: string
}

export default function FeeRatesPage() {
  const [activeTab, setActiveTab] = useState('engineering')
  const [rates, setRates] = useState<FeeRate[]>([])
  const [loading, setLoading] = useState(false)
  const [companies, setCompanies] = useState<InsuranceCompany[]>([])
  const [modal, setModal] = useState(false)
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const isFireTab = activeTab === 'fire'

  const loadRates = useCallback(async () => {
    setLoading(true)
    const res = await api.get<FeeRate[]>(`/api/admin/fee-rates?type=${isFireTab ? '火險' : '工程'}`)
    if (res.success && res.data) setRates(res.data)
    setLoading(false)
  }, [isFireTab])

  useEffect(() => {
    api.get<{ insuranceCompanies: InsuranceCompany[] }>('/api/meta').then((res) => {
      if (res.success && res.data) setCompanies(res.data.insuranceCompanies)
    })
  }, [])

  useEffect(() => { loadRates() }, [loadRates])

  const handleDelete = async (id: number) => {
    const res = await api.delete(`/api/admin/fee-rates?id=${id}&type=${isFireTab ? '火險' : '工程'}`)
    if (res.success) {
      message.success('已刪除')
      loadRates()
    } else {
      message.error(res.error ?? '刪除失敗')
    }
  }

  const handleSubmit = async (values: Record<string, unknown>) => {
    setSubmitting(true)
    const body = {
      ...values,
      type: isFireTab ? '火險' : '工程',
      effectiveDate: dayjs(values.effectiveDate as string).toISOString(),
    }
    const res = await api.post('/api/admin/fee-rates', body)
    setSubmitting(false)
    if (res.success) {
      message.success('新增成功')
      form.resetFields()
      setModal(false)
      loadRates()
    } else {
      message.error(res.error ?? '新增失敗')
    }
  }

  const baseColumns = [
    { title: '公司代碼', dataIndex: 'companyCode', key: 'code' },
    { title: '公司名稱', dataIndex: 'companyName', key: 'name' },
    { title: '借記單類型', dataIndex: 'debitNoteType', key: 'debit' },
    { title: '最低費用', dataIndex: 'minFee', key: 'min', align: 'right' as const, render: (v: number) => v.toLocaleString() },
    { title: '費率結構', dataIndex: 'rateBands', key: 'bands', ellipsis: true },
    { title: '生效日', dataIndex: 'effectiveDate', key: 'date', render: (v: string) => dayjs(v).format('YYYY-MM-DD') },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, r: FeeRate) => (
        <Popconfirm title="確定刪除？" onConfirm={() => handleDelete(r.id)}>
          <Button type="text" danger size="small" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ]

  const engColumns = [
    ...baseColumns.slice(0, 4),
    { title: '險種', dataIndex: 'insuranceType', key: 'type' },
    ...baseColumns.slice(4),
  ]

  const tabItems = [
    {
      key: 'engineering',
      label: '工程/責任險費率',
      children: (
        <Table dataSource={rates} columns={engColumns} rowKey="id" loading={loading} size="small" pagination={false} scroll={{ x: 900 }} />
      ),
    },
    {
      key: 'fire',
      label: '火險費率',
      children: (
        <Table dataSource={rates} columns={baseColumns} rowKey="id" loading={loading} size="small" pagination={false} scroll={{ x: 900 }} />
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>費率表管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModal(true)} style={{ background: '#1B4F8C' }}>
          新增費率
        </Button>
      </div>

      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
      </Card>

      <Modal title="新增費率" open={modal} onCancel={() => setModal(false)} footer={null} width={600} destroyOnClose>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item label="保險公司" name="companyCode" rules={[{ required: true }]}>
            <Select
              showSearch
              filterOption={(i, o) => String(o?.children ?? '').includes(i)}
              onChange={(v) => {
                const co = companies.find((c) => c.code === v)
                if (co) form.setFieldValue('companyName', co.name)
              }}
            >
              {companies.map((c) => <Option key={c.code} value={c.code}>{c.name}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="companyName" hidden><Input /></Form.Item>
          {!isFireTab && (
            <Form.Item label="險種" name="insuranceType" rules={[{ required: !isFireTab }]}>
              <Input />
            </Form.Item>
          )}
          <Form.Item label="借記單類型" name="debitNoteType" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="最低費用" name="minFee" initialValue={20000}>
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item label="費率結構（JSON）" name="rateBands" rules={[{ required: true }]}>
            <Input.TextArea rows={3} placeholder='[{"limit":5000000,"rate":0.004}]' />
          </Form.Item>
          <Form.Item label="生效日" name="effectiveDate" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          {isFireTab && (
            <Form.Item label="備註" name="remarks"><Input /></Form.Item>
          )}
          {!isFireTab && (
            <>
              <Form.Item label="子費率" name="subRate"><Input /></Form.Item>
              <Space style={{ width: '100%' }}>
                <Form.Item label="餐費" name="mealExpense" initialValue={0}>
                  <InputNumber min={0} />
                </Form.Item>
                <Form.Item label="住宿費" name="accommodationExpense" initialValue={0}>
                  <InputNumber min={0} />
                </Form.Item>
                <Form.Item label="照相費" name="photoFee" initialValue={0}>
                  <InputNumber min={0} />
                </Form.Item>
              </Space>
            </>
          )}
          <Space>
            <Button type="primary" htmlType="submit" loading={submitting} style={{ background: '#1B4F8C' }}>新增</Button>
            <Button onClick={() => setModal(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}
