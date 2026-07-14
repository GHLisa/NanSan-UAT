'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Card, Typography, Select, Table, Row, Col, Spin, Button, message } from 'antd'
import { FileExcelOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title, Text } = Typography

const fmtFee = (v: number) => v > 0 ? `$${v.toLocaleString()}` : '—'
const fmtN   = (v: number) => v > 0 ? v : '—'

interface Employee { id: number; name: string }
interface Department { id: number; name: string }

interface ReportData {
  rows: Record<string, number | string>[]
  employees: Employee[]
  totals: Record<string, number>
  departments: Department[]
  deptName: string
}

export default function OpenFeeReportPage() {
  const { session } = useAuth()
  const role = session?.role ?? ''
  const isWide = ['vp', 'sysadmin', 'admin_staff'].includes(role)
  const defaultDeptId = session?.departmentId ?? null

  const [filterDeptId, setFilterDeptId] = useState<number | null>(isWide ? null : defaultDeptId)
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterDeptId) params.set('deptId', String(filterDeptId))
    const res = await api.get<ReportData>(`/api/reports/open-fee?${params.toString()}`)
    if (res.success && res.data) setData(res.data)
    setLoading(false)
  }, [filterDeptId])

  useEffect(() => { loadData() }, [loadData])

  // 匯出 Excel（與畫面相同部門篩選；含合計與預估公證費 60% 列）
  async function handleExport() {
    if (!filterDeptId) { message.warning('請先選擇部門'); return }
    setExporting(true)
    try {
      const res = await fetch(`/api/reports/open-fee/export?deptId=${filterDeptId}`, { credentials: 'include' })
      if (!res.ok) { message.error('匯出失敗，請稍後再試'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `各員工未決件數預估公證費_${data?.deptName ?? ''}_${dayjs().format('YYYYMMDD')}.xlsx`
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

  const { rows = [], employees = [], totals = {}, deptName = '' } = data ?? {}

  // ── 兩層 header 欄位定義 ────────────────────────────────────────────────
  const columns = useMemo(() => [
    {
      title: '公證編號年度',
      dataIndex: 'year',
      key: 'year',
      width: 120,
      fixed: 'left' as const,
    },
    ...employees.map(emp => ({
      title: emp.name,
      children: [
        {
          title: '未決件數',
          dataIndex: `cnt_${emp.id}`,
          key: `cnt_${emp.id}`,
          width: 76,
          align: 'center' as const,
          render: (v: number) => fmtN(v),
        },
        {
          title: '預估公證費',
          dataIndex: `fee_${emp.id}`,
          key: `fee_${emp.id}`,
          width: 120,
          align: 'right' as const,
          render: (v: number) => fmtFee(v),
        },
      ],
    })),
    ...(role !== 'handler' ? [{
      title: '合計',
      children: [
        { title: '未決件數', dataIndex: 'rowCnt', key: 'rowCnt', width: 76, align: 'center' as const, render: (v: number) => fmtN(v) },
        { title: '預估公證費', dataIndex: 'rowFee', key: 'rowFee', width: 120, align: 'right' as const, render: (v: number) => fmtFee(v) },
      ],
    }] : []),
  ], [employees, role])

  // ── 合計 + 60% 兩列 summary ─────────────────────────────────────────────
  const summaryRows = useMemo(() => {
    if (!employees.length || !Object.keys(totals).length) return null

    const grandIdx = 1 + employees.length * 2
    const grandFee60 = Math.round((totals.grandFee ?? 0) * 0.6)

    return (
      <Table.Summary fixed>
        {/* 合計 row */}
        <Table.Summary.Row style={{ background: '#fafafa' }}>
          <Table.Summary.Cell index={0} align="left">
            <Text strong>合計</Text>
          </Table.Summary.Cell>
          {employees.flatMap((emp, i) => {
            const base = 1 + i * 2
            return [
              <Table.Summary.Cell key={`cnt_${emp.id}`} index={base} align="center">
                <Text strong>{fmtN(totals[`cnt_${emp.id}`] ?? 0)}</Text>
              </Table.Summary.Cell>,
              <Table.Summary.Cell key={`fee_${emp.id}`} index={base + 1} align="right">
                <Text strong>{fmtFee(totals[`fee_${emp.id}`] ?? 0)}</Text>
              </Table.Summary.Cell>,
            ]
          })}
          {role !== 'handler' && <>
            <Table.Summary.Cell index={grandIdx} align="center">
              <Text strong>{fmtN(totals.grandCnt ?? 0)}</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={grandIdx + 1} align="right">
              <Text strong>{fmtFee(totals.grandFee ?? 0)}</Text>
            </Table.Summary.Cell>
          </>}
        </Table.Summary.Row>

        {/* 預估公證費 60% row */}
        <Table.Summary.Row style={{ background: '#EBF4FC' }}>
          <Table.Summary.Cell index={0} align="left">
            <Text strong style={{ color: '#1B4F8C' }}>預估公證費 60%</Text>
          </Table.Summary.Cell>
          {employees.flatMap((emp, i) => {
            const base = 1 + i * 2
            const fee60 = Math.round((totals[`fee_${emp.id}`] ?? 0) * 0.6)
            return [
              <Table.Summary.Cell key={`cnt60_${emp.id}`} index={base} align="center">
                <Text type="secondary">—</Text>
              </Table.Summary.Cell>,
              <Table.Summary.Cell key={`fee60_${emp.id}`} index={base + 1} align="right">
                <Text strong style={{ color: '#1B4F8C' }}>{fmtFee(fee60)}</Text>
              </Table.Summary.Cell>,
            ]
          })}
          {role !== 'handler' && <>
            <Table.Summary.Cell index={grandIdx} align="center">
              <Text type="secondary">—</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={grandIdx + 1} align="right">
              <Text strong style={{ color: '#1B4F8C' }}>{fmtFee(grandFee60)}</Text>
            </Table.Summary.Cell>
          </>}
        </Table.Summary.Row>
      </Table.Summary>
    )
  }, [employees, totals, role])

  const cardTitle = filterDeptId && deptName
    ? `${deptName} — 各員工未決案件統計`
    : '請選擇部門'

  return (
    <div style={{ padding: 24 }}>
      {/* ── Sticky 篩選列 ── */}
      <div style={{
        position: 'sticky', top: 64, zIndex: 50,
        background: '#F5F7FA', paddingTop: 16, paddingBottom: 12,
        borderBottom: '1px solid #f0f0f0', marginBottom: 16,
      }}>
        <Row justify="space-between" align="middle" style={{ marginBottom: 4 }}>
          <Col>
            <Title level={4} style={{ margin: 0, display: 'inline', marginRight: 16 }}>
              各員工未決件數&amp;預估公證費
            </Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              訂定下一年度業績目標參考量化數據
            </Text>
          </Col>
          <Col>
            <Button
              color="green"
              variant="solid"
              icon={<FileExcelOutlined />}
              onClick={handleExport}
              loading={exporting}
              disabled={loading || !filterDeptId || !rows.length}
            >
              匯出 Excel
            </Button>
          </Col>
        </Row>
        <div style={{ marginTop: 12 }}>
          <Card size="small">
            <Select
              value={filterDeptId}
              onChange={isWide ? setFilterDeptId : undefined}
              options={(data?.departments ?? []).map(d => ({ value: d.id, label: d.name }))}
              style={{ width: 160 }}
              placeholder="選擇部門"
              disabled={!isWide}
            />
          </Card>
        </div>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>}

      {!loading && (
        <Card title={cardTitle} size="small">
          {filterDeptId ? (
            rows.length > 0 ? (
              <>
                <Table
                  dataSource={rows as Record<string, unknown>[]}
                  columns={columns}
                  rowKey="_year"
                  size="small"
                  bordered
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  summary={() => summaryRows}
                />
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                  註：未決件數僅計主辦；預估公證費依承辦比例分攤。
                </Text>
              </>
            ) : (
              <Text type="secondary">該部門目前無未決案件。</Text>
            )
          ) : (
            <Text type="secondary">請先選擇部門以顯示統計資料。</Text>
          )}
        </Card>
      )}
    </div>
  )
}
