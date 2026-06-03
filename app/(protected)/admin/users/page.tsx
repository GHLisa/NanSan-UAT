'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  Table, Button, Card, Row, Col, Typography, Tag, Space, Modal, Form,
  Input, Select, Switch, message, Divider,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, MailOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'

const { Title } = Typography

const ROLE_LABEL: Record<string, string> = {
  handler: '承辦人', team_lead: '組長', dept_manager: '部門主管',
  vp: '執行副總', admin_staff: '行政人員', sysadmin: '系統管理員',
}
const ROLE_COLOR: Record<string, string> = {
  handler: 'blue', team_lead: 'cyan', dept_manager: 'purple',
  vp: 'gold', admin_staff: 'orange', sysadmin: 'red',
}
const ROLE_ORDER: Record<string, number> = {
  handler: 1, team_lead: 2, dept_manager: 3, vp: 4, admin_staff: 5, sysadmin: 6,
}
const GROUP_ORDER: Record<string, number> = { '一組': 1, '二組': 2 }
const TEAM_GROUP_ROLES = ['handler', 'team_lead']
const ROLE_OPTIONS = Object.entries(ROLE_LABEL).map(([v, label]) => ({ value: v, label }))
const TEAM_GROUP_OPTIONS = [{ value: '一組', label: '一組' }, { value: '二組', label: '二組' }]

interface RoleItem {
  id: number; role: string; roleName: string
  departmentId: number | null; departmentName: string | null
  teamGroup: string | null; isPrimary: boolean
}
interface EmployeeItem {
  id: number; name: string; username: string; email: string | null
  isActive: boolean; roles: RoleItem[]
}
interface AdditionalRole { tempId: number; role: string | null; departmentId: number | null; teamGroup: string | null }

export default function UsersPage() {
  const [employees, setEmployees] = useState<EmployeeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState<number | null>(null)
  const [depts, setDepts] = useState<{ id: number; name: string }[]>([])

  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<EmployeeItem | null>(null)
  const [additionalRoles, setAdditionalRoles] = useState<AdditionalRole[]>([])
  const [form] = Form.useForm()

  const stickyRef = useRef<HTMLDivElement>(null)
  const [stickyH, setStickyH] = useState(0)
  useEffect(() => { if (stickyRef.current) setStickyH(stickyRef.current.offsetHeight) })

  const loadEmployees = useCallback(async () => {
    setLoading(true)
    const res = await api.get<EmployeeItem[]>('/api/admin/users')
    if (res.success && res.data) setEmployees(res.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadEmployees()
    api.get<{ departments: { id: number; name: string }[] }>('/api/meta').then(res => {
      if (res.success && res.data) setDepts(res.data.departments)
    })
  }, [loadEmployees])

  // 篩選 + 排序
  const filtered = useMemo(() => {
    let result = employees
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(e => e.name.toLowerCase().includes(q) || e.username.toLowerCase().includes(q) || (e.email ?? '').toLowerCase().includes(q))
    }
    if (filterDept) {
      result = result.filter(e => e.roles.some(r => r.departmentId === filterDept))
    }
    return [...result].sort((a, b) => {
      const pa = a.roles.find(r => r.isPrimary)
      const pb = b.roles.find(r => r.isPrimary)
      const deptCmp = (pa?.departmentName ?? '~').localeCompare(pb?.departmentName ?? '~', 'zh-TW')
      if (deptCmp !== 0) return deptCmp
      const grpCmp = (GROUP_ORDER[pa?.teamGroup ?? ''] ?? 9) - (GROUP_ORDER[pb?.teamGroup ?? ''] ?? 9)
      if (grpCmp !== 0) return grpCmp
      return (ROLE_ORDER[pa?.role ?? ''] ?? 9) - (ROLE_ORDER[pb?.role ?? ''] ?? 9)
    })
  }, [employees, search, filterDept])

  function openNew() {
    setEditTarget(null)
    form.resetFields()
    form.setFieldsValue({ isActive: true })
    setAdditionalRoles([])
    setModalOpen(true)
  }

  function openEdit(emp: EmployeeItem) {
    setEditTarget(emp)
    const primary = emp.roles.find(r => r.isPrimary)
    form.setFieldsValue({
      name: emp.name, username: emp.username,
      email: emp.email ?? '', isActive: emp.isActive,
      role: primary?.role, departmentId: primary?.departmentId,
      teamGroup: primary?.teamGroup ?? null,
    })
    setAdditionalRoles(emp.roles.filter(r => !r.isPrimary).map(r => ({
      tempId: r.id, role: r.role, departmentId: r.departmentId, teamGroup: r.teamGroup,
    })))
    setModalOpen(true)
  }

  function closeModal() { setModalOpen(false); form.resetFields(); setEditTarget(null); setAdditionalRoles([]) }

  function addAdditionalRole() {
    setAdditionalRoles(prev => [...prev, { tempId: Date.now(), role: null, departmentId: null, teamGroup: null }])
  }
  function removeAdditionalRole(tempId: number) {
    setAdditionalRoles(prev => prev.filter(r => r.tempId !== tempId))
  }
  function updateAdditionalRole(tempId: number, field: string, value: unknown) {
    setAdditionalRoles(prev => prev.map(r => r.tempId === tempId ? { ...r, [field]: value, ...(field === 'role' ? { teamGroup: null } : {}) } : r))
  }

  async function handleSubmit(values: Record<string, unknown>) {
    // Validate additional roles
    for (const ar of additionalRoles) {
      if (!ar.role) { message.error('附加身分的角色為必填'); return }
      if (TEAM_GROUP_ROLES.includes(ar.role) && !ar.teamGroup) {
        message.error('承辦人與組長的附加身分需選擇組別'); return
      }
    }

    // Check duplicate identities
    const allRoles = [
      { role: values.role as string, departmentId: values.departmentId as number | null, teamGroup: (TEAM_GROUP_ROLES.includes(values.role as string) ? values.teamGroup : null) as string | null },
      ...additionalRoles.map(ar => ({ role: ar.role!, departmentId: ar.departmentId, teamGroup: TEAM_GROUP_ROLES.includes(ar.role!) ? ar.teamGroup : null })),
    ]
    const seen = new Set<string>()
    for (const r of allRoles) {
      if (!r.role) continue
      const key = `${r.role}|${r.departmentId}|${r.teamGroup}`
      if (seen.has(key)) { message.error('身分重複：相同角色、部門與組別已存在'); return }
      seen.add(key)
    }

    const primaryRole = { role: values.role as string, departmentId: (values.departmentId as number | null) ?? null, teamGroup: (TEAM_GROUP_ROLES.includes(values.role as string) ? (values.teamGroup as string | null) : null) ?? null }
    const additionalRolesPayload = additionalRoles.map(ar => ({ role: ar.role!, departmentId: ar.departmentId ?? null, teamGroup: TEAM_GROUP_ROLES.includes(ar.role!) ? (ar.teamGroup ?? null) : null }))

    let res
    if (editTarget) {
      res = await api.put(`/api/admin/users/${editTarget.id}`, {
        name: values.name, email: values.email || null, isActive: values.isActive,
        primaryRole, additionalRoles: additionalRolesPayload,
      })
      if (res.success) message.success('帳號已更新')
    } else {
      res = await api.post('/api/admin/users', {
        name: values.name, username: values.username,
        email: values.email || undefined, isActive: values.isActive,
        primaryRole, additionalRoles: additionalRolesPayload,
      })
      if (res.success) message.success('帳號已新增（初始密碼 nansan1234）')
    }

    if (res.success) { closeModal(); loadEmployees() }
    else message.error(res.error ?? '操作失敗')
  }

  const columns = [
    {
      title: 'No.', key: 'no', width: 55, align: 'center' as const,
      render: (_: unknown, __: unknown, index: number) => index + 1,
    },
    { title: '姓名', dataIndex: 'name', key: 'name', width: 90 },
    { title: '帳號', dataIndex: 'username', key: 'username', width: 120 },
    {
      title: 'Email', dataIndex: 'email', key: 'email', width: 200,
      render: (v: string | null) => v
        ? <a href={`mailto:${v}`} style={{ fontSize: 12 }}><MailOutlined style={{ marginRight: 4 }} />{v}</a>
        : <span style={{ color: '#bbb', fontSize: 12 }}>—</span>,
    },
    {
      title: '身分（角色／部門）', key: 'roles',
      render: (_: unknown, r: EmployeeItem) => (
        <Space size={4} wrap>
          {r.roles.map(role => (
            <Tag key={role.id} color={ROLE_COLOR[role.role] ?? 'default'} style={{ fontSize: 11 }}>
              {role.isPrimary ? '' : '＋'}{role.roleName}（{role.departmentName ?? '全公司'}{role.teamGroup ? `／${role.teamGroup}` : ''}）
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '狀態', dataIndex: 'isActive', key: 'isActive', width: 80,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '啟用' : '停用'}</Tag>,
    },
    {
      title: '操作', key: 'action', width: 80, fixed: 'right' as const,
      render: (_: unknown, r: EmployeeItem) => (
        <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>編輯</Button>
      ),
    },
  ]

  return (
    <div style={{ padding: 0 }}>
      {/* Sticky header */}
      <div ref={stickyRef} style={{ position: 'sticky', top: 64, zIndex: 20, background: '#F5F7FA', padding: '24px 24px 0', borderRadius: '8px 8px 0 0' }}>
        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
          <Col><Title level={4} style={{ margin: 0 }}>使用者帳號管理</Title></Col>
          <Col>
            <Button type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C' }} onClick={openNew}>
              新增帳號
            </Button>
          </Col>
        </Row>
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space size={12}>
            <Input.Search
              placeholder="搜尋姓名、帳號..."
              style={{ width: 240 }}
              onSearch={setSearch}
              onChange={e => !e.target.value && setSearch('')}
              allowClear
            />
            <Select
              placeholder="部門篩選" allowClear style={{ width: 160 }}
              value={filterDept} onChange={setFilterDept}
              options={depts.map(d => ({ value: d.id, label: d.name }))}
            />
          </Space>
        </Card>
      </div>

      <div style={{ padding: '0 24px 24px' }}>
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="small"
          scroll={{ x: 1100 }}
          sticky={{ offsetHeader: 64 + stickyH }}
          pagination={{ pageSize: 15, showTotal: t => `共 ${t} 筆` }}
        />
      </div>

      {/* 單一 Modal（新增 + 編輯合一）*/}
      <Modal
        title={editTarget ? `編輯帳號 — ${editTarget.name}` : '新增帳號'}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        okText={editTarget ? '儲存' : '新增'}
        cancelText="取消"
        okButtonProps={{ style: { background: '#1B4F8C' } }}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="姓名" rules={[{ required: true, message: '必填' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="username" label="帳號" rules={[{ required: true, message: '必填' }]}>
                <Input disabled={!!editTarget} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="email" label="Email（寄信通知用）" rules={[{ type: 'email', message: '請輸入有效的 Email 格式' }]}>
            <Input prefix={<MailOutlined style={{ color: '#bbb' }} />} placeholder="example@company.com.tw" />
          </Form.Item>

          <Divider style={{ fontSize: 12, color: '#1B4F8C', margin: '4px 0 12px', borderColor: '#1B4F8C' }}>
            <span style={{ fontSize: 12, color: '#1B4F8C' }}>主要身分</span>
          </Divider>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="role" label="角色" rules={[{ required: true, message: '必填' }]}>
                <Select options={ROLE_OPTIONS} onChange={() => form.validateFields(['teamGroup'])} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="departmentId" label="部門">
                <Select allowClear placeholder="選擇部門" options={depts.map(d => ({ value: d.id, label: d.name }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="teamGroup" label="組別"
                dependencies={['role']}
                rules={[{
                  validator(_, value) {
                    const role = form.getFieldValue('role')
                    if (TEAM_GROUP_ROLES.includes(role) && !value) return Promise.reject(new Error('必填'))
                    return Promise.resolve()
                  },
                }]}
              >
                <Select allowClear placeholder="選擇組別" options={TEAM_GROUP_OPTIONS} />
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ fontSize: 12, color: '#1B4F8C', margin: '4px 0 10px', borderColor: '#1B4F8C' }}>
            <span style={{ fontSize: 12, color: '#1B4F8C' }}>附加身分</span>
          </Divider>
          {additionalRoles.map(ar => (
            <Row key={ar.tempId} gutter={8} align="middle" style={{ marginBottom: 8 }}>
              <Col flex="1">
                <Select size="small" placeholder="角色（必填）" style={{ width: '100%' }}
                  value={ar.role} options={ROLE_OPTIONS}
                  onChange={v => updateAdditionalRole(ar.tempId, 'role', v)}
                  status={ar.role ? '' : 'error'} />
              </Col>
              <Col flex="1">
                <Select size="small" placeholder="部門" style={{ width: '100%' }} allowClear
                  value={ar.departmentId} options={depts.map(d => ({ value: d.id, label: d.name }))}
                  onChange={v => updateAdditionalRole(ar.tempId, 'departmentId', v)} />
              </Col>
              <Col style={{ width: 96 }}>
                <Select size="small" placeholder="組別" style={{ width: '100%' }} allowClear
                  value={ar.teamGroup} options={TEAM_GROUP_OPTIONS}
                  disabled={!TEAM_GROUP_ROLES.includes(ar.role ?? '')}
                  status={TEAM_GROUP_ROLES.includes(ar.role ?? '') && !ar.teamGroup ? 'error' : ''}
                  onChange={v => updateAdditionalRole(ar.tempId, 'teamGroup', v)} />
              </Col>
              <Col style={{ width: 32 }}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />}
                  onClick={() => removeAdditionalRole(ar.tempId)} />
              </Col>
            </Row>
          ))}
          <Button size="small" type="dashed" icon={<PlusOutlined />}
            onClick={addAdditionalRole} style={{ width: '100%', marginBottom: 12 }}>
            新增身分
          </Button>

          <Form.Item name="isActive" label="帳號狀態" valuePropName="checked" style={{ marginBottom: 0 }}>
            <Switch checkedChildren="啟用" unCheckedChildren="停用" />
          </Form.Item>
          {!editTarget && (
            <div style={{ color: '#888', fontSize: 12, marginTop: 8 }}>
              ※ 初始密碼為 nansan1234，使用者首次登入後請修改
            </div>
          )}
        </Form>
      </Modal>
    </div>
  )
}
