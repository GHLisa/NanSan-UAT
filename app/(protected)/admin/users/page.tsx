'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Card, Table, Button, Modal, Form, Input, Switch, Typography, Space, Tag, message,
  Popconfirm, Descriptions, Select,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, UserAddOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'

const { Title } = Typography

interface RoleItem {
  id: number
  role: string
  roleName: string
  departmentId: number | null
  departmentName: string | null
  teamGroup: string | null
  isPrimary: boolean
}

interface EmployeeItem {
  id: number
  name: string
  username: string
  email: string | null
  isActive: boolean
  roles: RoleItem[]
}

const ROLE_OPTIONS = [
  { value: 'handler', label: '公證人員' },
  { value: 'team_lead', label: '組長' },
  { value: 'dept_manager', label: '部門主管' },
  { value: 'vp', label: '副總' },
  { value: 'admin_staff', label: '行政人員' },
  { value: 'sysadmin', label: '系統管理員' },
]

export default function UsersPage() {
  const [employees, setEmployees] = useState<EmployeeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [createModal, setCreateModal] = useState(false)
  const [editModal, setEditModal] = useState<EmployeeItem | null>(null)
  const [roleModal, setRoleModal] = useState<EmployeeItem | null>(null)
  const [createForm] = Form.useForm()
  const [editForm] = Form.useForm()
  const [roleForm] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)

  const loadEmployees = useCallback(async () => {
    setLoading(true)
    const res = await api.get<EmployeeItem[]>('/api/admin/users')
    if (res.success && res.data) setEmployees(res.data)
    setLoading(false)
  }, [])

  useEffect(() => { loadEmployees() }, [loadEmployees])

  const handleCreate = async (values: Record<string, unknown>) => {
    setSubmitting(true)
    const res = await api.post('/api/admin/users', values)
    setSubmitting(false)
    if (res.success) {
      message.success('建立成功')
      createForm.resetFields()
      setCreateModal(false)
      loadEmployees()
    } else {
      message.error(res.error ?? '建立失敗')
    }
  }

  const handleEdit = async (values: Record<string, unknown>) => {
    if (!editModal) return
    setSubmitting(true)
    const body: Record<string, unknown> = {}
    if (values.name) body.name = values.name
    if (values.email !== undefined) body.email = values.email
    if (values.isActive !== undefined) body.isActive = values.isActive
    if (values.password) body.password = values.password
    const res = await api.put(`/api/admin/users/${editModal.id}`, body)
    setSubmitting(false)
    if (res.success) {
      message.success('更新成功')
      setEditModal(null)
      loadEmployees()
    } else {
      message.error(res.error ?? '更新失敗')
    }
  }

  const handleAddRole = async (values: Record<string, unknown>) => {
    if (!roleModal) return
    setSubmitting(true)
    const roleOpt = ROLE_OPTIONS.find((r) => r.value === values.role)
    const res = await api.patch(`/api/admin/users/${roleModal.id}`, {
      action: 'add',
      role: values.role,
      roleName: roleOpt?.label ?? String(values.role),
      departmentId: null,
      isPrimary: false,
    })
    setSubmitting(false)
    if (res.success) {
      message.success('角色已新增')
      roleForm.resetFields()
      setRoleModal(null)
      loadEmployees()
    } else {
      message.error(res.error ?? '新增失敗')
    }
  }

  const handleRemoveRole = async (empId: number, roleId: number) => {
    const res = await api.patch(`/api/admin/users/${empId}`, { action: 'remove', roleId })
    if (res.success) {
      message.success('已移除角色')
      loadEmployees()
    } else {
      message.error(res.error ?? '移除失敗')
    }
  }

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 60 },
    { title: '姓名', dataIndex: 'name', key: 'name' },
    { title: '帳號', dataIndex: 'username', key: 'username' },
    { title: 'Email', dataIndex: 'email', key: 'email', render: (v: string | null) => v ?? '-' },
    {
      title: '狀態',
      dataIndex: 'isActive',
      key: 'active',
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '啟用' : '停用'}</Tag>,
    },
    {
      title: '角色',
      key: 'roles',
      render: (_: unknown, r: EmployeeItem) => (
        <Space size={4} wrap>
          {r.roles.map((role) => (
            <Tag key={role.id} color="blue">{role.roleName}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, r: EmployeeItem) => (
        <Space>
          <Button
            type="text" size="small" icon={<EditOutlined />}
            onClick={() => {
              setEditModal(r)
              editForm.setFieldsValue({ name: r.name, email: r.email, isActive: r.isActive })
            }}
          />
          <Button
            type="text" size="small" icon={<UserAddOutlined />}
            onClick={() => setRoleModal(r)}
          />
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>使用者帳號管理</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModal(true)} style={{ background: '#1B4F8C' }}>
          新增員工
        </Button>
      </div>

      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Table
          dataSource={employees}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="small"
          expandable={{
            expandedRowRender: (r: EmployeeItem) => (
              <Descriptions size="small" column={3}>
                {r.roles.map((role) => (
                  <Descriptions.Item key={role.id} label={role.roleName}>
                    <Space>
                      <span>{role.departmentName ?? '全公司'}</span>
                      {role.isPrimary && <Tag color="gold">主要</Tag>}
                      <Popconfirm title="確定移除此角色？" onConfirm={() => handleRemoveRole(r.id, role.id)}>
                        <Button type="text" danger size="small" icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  </Descriptions.Item>
                ))}
              </Descriptions>
            ),
          }}
          pagination={{ pageSize: 30, showTotal: (t) => `共 ${t} 筆` }}
        />
      </Card>

      {/* Create Modal */}
      <Modal title="新增員工" open={createModal} onCancel={() => setCreateModal(false)} footer={null} destroyOnClose>
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item label="姓名" name="name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="帳號" name="username" rules={[{ required: true, min: 3 }]}><Input /></Form.Item>
          <Form.Item label="密碼" name="password" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item label="Email" name="email"><Input type="email" /></Form.Item>
          <Form.Item label="啟用" name="isActive" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={submitting} style={{ background: '#1B4F8C' }}>建立</Button>
            <Button onClick={() => setCreateModal(false)}>取消</Button>
          </Space>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal title="編輯員工資料" open={!!editModal} onCancel={() => setEditModal(null)} footer={null} destroyOnClose>
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item label="姓名" name="name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="Email" name="email"><Input type="email" /></Form.Item>
          <Form.Item label="新密碼（留空不修改）" name="password">
            <Input.Password />
          </Form.Item>
          <Form.Item label="啟用" name="isActive" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={submitting} style={{ background: '#1B4F8C' }}>儲存</Button>
            <Button onClick={() => setEditModal(null)}>取消</Button>
          </Space>
        </Form>
      </Modal>

      {/* Role Modal */}
      <Modal title={`新增角色 - ${roleModal?.name}`} open={!!roleModal} onCancel={() => setRoleModal(null)} footer={null} destroyOnClose>
        <Form form={roleForm} layout="vertical" onFinish={handleAddRole}>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select>
              {ROLE_OPTIONS.map((r) => <Select.Option key={r.value} value={r.value}>{r.label}</Select.Option>)}
            </Select>
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={submitting} style={{ background: '#1B4F8C' }}>新增</Button>
            <Button onClick={() => setRoleModal(null)}>取消</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}
