'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Card, Typography, Select, Table, Row, Col, Spin, Button, message } from 'antd'
import { FileExcelOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title, Text } = Typography

const fmt  = (v: number) => v > 0 ? `$${v.toLocaleString()}` : '—'
const fmtN = (v: number) => v > 0 ? v : '—'

interface Employee { id: number; name: string }
interface Department { id: number; name: string }

interface ReportData {
  rows: Record<string, number | string>[]
  employees: Employee[]
  departments: Department[]
  deptName: string
}

export default function FeeYearlyReportPage() {
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
    const res = await api.get<ReportData>(`/api/reports/yearly-fees?${params.toString()}`)
    if (res.success && res.data) setData(res.data)
    setLoading(false)
  }, [filterDeptId])

  useEffect(() => { loadData() }, [loadData])

  // 匯出 Excel（與畫面相同部門篩選）
  async function handleExport() {
    if (!filterDeptId) { message.warning('請先選擇部門'); return }
    setExporting(true)
    try {
      const res = await fetch(`/api/reports/yearly-fees/export?deptId=${filterDeptId}`, { credentials: 'include' })
      if (!res.ok) { message.error('匯出失敗，請稍後再試'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `各年度已決未決公證費_${data?.deptName ?? ''}_${dayjs().format('YYYYMMDD')}.xlsx`
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

  // 合計列
  const sumRow = useMemo(() => {
    if (!data) return null
    const s: Record<string, number> = { total: 0, closedCnt: 0, openCnt: 0, closedFee: 0, openFee: 0 }
    for (const emp of data.employees) s[`e${emp.id}`] = 0
    for (const r of data.rows) {
      s.total     += (r.total     as number) || 0
      s.closedCnt += (r.closedCnt as number) || 0
      s.openCnt   += (r.openCnt   as number) || 0
      s.closedFee += (r.closedFee as number) || 0
      s.openFee   += (r.openFee   as number) || 0
      for (const emp of data.employees) {
        s[`e${emp.id}`] += (r[`e${emp.id}`] as number) || 0
      }
    }
    return s
  }, [data])

  const fixedCols = [
    { title: '公證編號年度', dataIndex: 'year',      key: 'year',      width: 120, fixed: 'left' as const },
    { title: '接案量',   dataIndex: 'total',     key: 'total',     width: 70,  align: 'center' as const, render: (v: number) => fmtN(v) },
    { title: '已決件數', dataIndex: 'closedCnt', key: 'closedCnt', width: 76,  align: 'center' as const, render: (v: number) => fmtN(v) },
    { title: '未決件數', dataIndex: 'openCnt',   key: 'openCnt',   width: 76,  align: 'center' as const, render: (v: number) => fmtN(v) },
    { title: '已決公證費',          dataIndex: 'closedFee', key: 'closedFee', width: 120, align: 'right' as const, render: (v: number) => fmt(v) },
    { title: '未決公證費（預估）',  dataIndex: 'openFee',   key: 'openFee',   width: 140, align: 'right' as const, render: (v: number) => fmt(v) },
  ]

  const empCols = (data?.employees ?? []).map(emp => ({
    title: emp.name,
    dataIndex: `e${emp.id}`,
    key: `e${emp.id}`,
    width: 76,
    align: 'center' as const,
    render: (v: number) => fmtN(v),
  }))

  const columns = [
    ...fixedCols,
    ...((empCols.length > 0 && role !== 'handler') ? [{
      title: '接案件數（僅主辦）',
      align: 'center' as const,
      children: empCols,
    }] : []),
  ]

  const cardTitle = filterDeptId && data?.deptName
    ? `${data.deptName} — 各年度已決&未決公證費及接案統計`
    : '請選擇部門'

  return (
    <div style={{ padding: 24 }}>
      {/* ── Sticky 篩選列 ── */}
      <div style={{
        position: 'sticky', top: 64, zIndex: 50,
        background: '#F5F7FA', paddingTop: 16, paddingBottom: 12,
        borderBottom: '1px solid #f0f0f0', marginBottom: 16,
      }}>
        <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
          <Col><Title level={4} style={{ margin: 0 }}>各年度已決&amp;未決公證費</Title></Col>
          <Col>
            <Button
              color="green"
              variant="solid"
              icon={<FileExcelOutlined />}
              onClick={handleExport}
              loading={exporting}
              disabled={loading || !filterDeptId || !data?.rows.length}
            >
              匯出 Excel
            </Button>
          </Col>
        </Row>
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

      {loading && <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>}

      {!loading && (
        <Card title={cardTitle} size="small">
          {filterDeptId && data && data.rows.length > 0 ? (
            <Table
              dataSource={data.rows as Record<string, unknown>[]}
              columns={columns}
              rowKey="_year"
              size="small"
              bordered
              pagination={false}
              scroll={{ x: 'max-content' }}
              summary={() => sumRow ? (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ background: '#fafafa' }}>
                    <Table.Summary.Cell index={0} align="left"><Text strong>合計</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="center"><Text strong>{fmtN(sumRow.total)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="center"><Text strong>{fmtN(sumRow.closedCnt)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="center"><Text strong>{fmtN(sumRow.openCnt)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right"><Text strong>{fmt(sumRow.closedFee)}</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={5} align="right"><Text strong>{fmt(sumRow.openFee)}</Text></Table.Summary.Cell>
                    {role !== 'handler' && (data?.employees ?? []).map((emp, i) => (
                      <Table.Summary.Cell key={emp.id} index={6 + i} align="center">
                        <Text strong>{fmtN(sumRow[`e${emp.id}`])}</Text>
                      </Table.Summary.Cell>
                    ))}
                  </Table.Summary.Row>
                </Table.Summary>
              ) : undefined}
            />
          ) : (
            <Text type="secondary">
              {filterDeptId ? '該部門尚無案件資料。' : '請先選擇部門以顯示統計資料。'}
            </Text>
          )}
        </Card>
      )}
    </div>
  )
}
