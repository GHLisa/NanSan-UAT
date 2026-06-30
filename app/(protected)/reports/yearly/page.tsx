'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, Typography, Select, Table, Space, Row, Col, Spin, Button, message } from 'antd'
import { FileExcelOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title, Text } = Typography

const STATUS_OPTIONS = [
  { value: 'all', label: '全部案件' },
  { value: '已決', label: '已決' },
  { value: '未決', label: '未決' },
]

interface Employee { id: number; name: string }
interface Department { id: number; name: string }

interface Tab1 {
  employees: Employee[]
  rows: Record<string, number | string>[]
}

interface Tab2 {
  employees: Employee[]
  rows: Record<string, number | string>[]
}

interface ReportData {
  tab1: Tab1 | null
  tab2: Tab2
  departments: Department[]
}

export default function YearlyCasesPage() {
  const { session } = useAuth()
  const role = session?.role ?? ''
  const isWide = ['vp', 'sysadmin', 'admin_staff'].includes(role)
  const defaultDeptId = session?.departmentId ?? null

  const [filterDeptId, setFilterDeptId] = useState<number | null>(defaultDeptId)
  const [filterStatus, setFilterStatus] = useState('all')
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ status: filterStatus })
    if (filterDeptId) params.set('deptId', String(filterDeptId))
    const res = await api.get<ReportData>(`/api/reports/yearly-cases?${params.toString()}`)
    if (res.success && res.data) setData(res.data)
    setLoading(false)
  }, [filterDeptId, filterStatus])

  useEffect(() => { loadData() }, [loadData])

  // 匯出 Excel（與畫面相同篩選條件；含各年度員工表＋各部門員工累計表）
  async function handleExport() {
    setExporting(true)
    try {
      const params = new URLSearchParams({ status: filterStatus })
      if (filterDeptId) params.set('deptId', String(filterDeptId))
      const res = await fetch(`/api/reports/yearly-cases/export?${params.toString()}`, { credentials: 'include' })
      if (!res.ok) { message.error('匯出失敗，請稍後再試'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `年度案件統計_${dayjs().format('YYYYMMDD')}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      message.error('匯出失敗，請稍後再試')
    } finally {
      setExporting(false)
    }
  }

  const deptName = data?.departments.find(d => d.id === filterDeptId)?.name ?? ''

  // ── Table 1 columns: 年度 + 員工... + 年度小計 ──────────────────────────
  function buildTab1Columns(employees: Employee[]) {
    return [
      { title: '年度', dataIndex: 'year', key: 'year', width: 90, fixed: 'left' as const },
      ...employees.map(emp => ({
        title: emp.name,
        dataIndex: `e${emp.id}`,
        key: `e${emp.id}`,
        width: 80,
        align: 'center' as const,
        render: (v: number) => v > 0 ? v : '—',
      })),
      ...(role !== 'handler' ? [{
        title: '年度小計',
        dataIndex: 'total',
        key: 'total',
        width: 90,
        align: 'center' as const,
        render: (v: number) => v > 0 ? <strong>{v}</strong> : '—',
      }] : []),
    ]
  }

  // ── Table 2 columns: 部門 + 員工... + 部門合計 ─────────────────────────
  function buildTab2Columns(employees: Employee[]) {
    return [
      { title: '部門', dataIndex: 'deptName', key: 'deptName', width: 130, fixed: 'left' as const },
      ...employees.map(emp => ({
        title: emp.name,
        dataIndex: `e${emp.id}`,
        key: `e${emp.id}`,
        width: 80,
        align: 'center' as const,
        render: (v: number) => v > 0 ? v : '—',
      })),
      {
        title: '部門合計',
        dataIndex: 'total',
        key: 'total',
        width: 90,
        align: 'center' as const,
        render: (v: number) => v > 0 ? <strong>{v}</strong> : '—',
      },
    ]
  }

  // ── Summary row renderer ────────────────────────────────────────────────
  function renderSummary1(employees: Employee[], tableData: Record<string, number | string>[]) {
    const grandTotal = tableData.reduce((s, r) => s + ((r.total as number) || 0), 0)
    return (
      <Table.Summary fixed>
        <Table.Summary.Row style={{ background: '#fafafa' }}>
          <Table.Summary.Cell index={0} align="left"><Text strong>合計</Text></Table.Summary.Cell>
          {employees.map((emp, i) => {
            const sum = tableData.reduce((s, r) => s + ((r[`e${emp.id}`] as number) || 0), 0)
            return (
              <Table.Summary.Cell key={emp.id} index={i + 1} align="center">
                <Text strong>{sum > 0 ? sum : '—'}</Text>
              </Table.Summary.Cell>
            )
          })}
          {role !== 'handler' && (
            <Table.Summary.Cell index={employees.length + 1} align="center">
              <Text strong>{grandTotal > 0 ? grandTotal : '—'}</Text>
            </Table.Summary.Cell>
          )}
        </Table.Summary.Row>
      </Table.Summary>
    )
  }

  function renderSummary2(employees: Employee[], tableData: Record<string, number | string>[]) {
    const grandTotal = tableData.reduce((s, r) => s + ((r.total as number) || 0), 0)
    return (
      <Table.Summary fixed>
        <Table.Summary.Row style={{ background: '#fafafa' }}>
          <Table.Summary.Cell index={0} align="left"><Text strong>合計</Text></Table.Summary.Cell>
          {employees.map((emp, i) => {
            const sum = tableData.reduce((s, r) => s + ((r[`e${emp.id}`] as number) || 0), 0)
            return (
              <Table.Summary.Cell key={emp.id} index={i + 1} align="center">
                <Text strong>{sum > 0 ? sum : '—'}</Text>
              </Table.Summary.Cell>
            )
          })}
          <Table.Summary.Cell index={employees.length + 1} align="center">
            <Text strong>{grandTotal > 0 ? grandTotal : '—'}</Text>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      </Table.Summary>
    )
  }

  return (
    <div style={{ padding: 24 }}>
      {/* ── Sticky 篩選列 ── */}
      <div style={{
        position: 'sticky', top: 64, zIndex: 50,
        background: '#F5F7FA', paddingTop: 16, paddingBottom: 12,
        borderBottom: '1px solid #f0f0f0', marginBottom: 16,
      }}>
        <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
          <Col><Title level={4} style={{ margin: 0 }}>各年度已決&amp;未決案件數</Title></Col>
          <Col>
            <Button
              icon={<FileExcelOutlined />}
              onClick={handleExport}
              loading={exporting}
              disabled={loading || !data}
            >
              匯出 Excel
            </Button>
          </Col>
        </Row>
        <Card size="small">
          <Space wrap>
            {isWide ? (
              <Select
                value={filterDeptId}
                onChange={setFilterDeptId}
                options={(data?.departments ?? []).map(d => ({ value: d.id, label: d.name }))}
                style={{ width: 160 }}
                placeholder="選擇部門（第一表）"
                allowClear
              />
            ) : (
              <Select
                value={filterDeptId}
                options={(data?.departments ?? []).filter(d => d.id === defaultDeptId).map(d => ({ value: d.id, label: d.name }))}
                style={{ width: 160 }}
                disabled
              />
            )}
            <Select
              value={filterStatus}
              onChange={setFilterStatus}
              options={STATUS_OPTIONS}
              style={{ width: 120 }}
            />
          </Space>
        </Card>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      )}

      {!loading && data && (
        <>
          {/* ── Table 1: 各年度員工接案件數 ── */}
          <Card
            title={filterDeptId
              ? `各年度員工接案件數（${deptName}）`
              : '各年度員工接案件數（請選擇部門）'}
            size="small"
            style={{ marginBottom: 16 }}
          >
            {data.tab1 && filterDeptId ? (
              <Table
                dataSource={data.tab1.rows as Record<string, unknown>[]}
                columns={buildTab1Columns(data.tab1.employees)}
                rowKey="_year"
                size="small"
                bordered
                pagination={false}
                scroll={{ x: 'max-content' }}
                summary={() => renderSummary1(data.tab1!.employees, data.tab1!.rows)}
              />
            ) : (
              <Text type="secondary">請先選擇部門以顯示各年度明細。</Text>
            )}
          </Card>

          {/* ── Table 2: 各部門各員工累計案件數（非 handler 才顯示）── */}
          {role !== 'handler' && (
            <Card title="各部門各員工接案件數（累計）" size="small">
              <Table
                dataSource={data.tab2.rows as Record<string, unknown>[]}
                columns={buildTab2Columns(data.tab2.employees)}
                rowKey="deptId"
                size="small"
                bordered
                pagination={false}
                scroll={{ x: 'max-content' }}
                summary={() => renderSummary2(data.tab2.employees, data.tab2.rows)}
              />
            </Card>
          )}
        </>
      )}
    </div>
  )
}
