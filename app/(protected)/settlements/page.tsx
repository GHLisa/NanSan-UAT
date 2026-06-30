'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table, Card, Row, Col, Typography, Tag, Select, Button, Statistic, Input, DatePicker, message,
} from 'antd'
import { FileExcelOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'

const { Title } = Typography

const YEAR_OPTIONS = [
  { value: '', label: '全部年份' },
  { value: '2024', label: '2024 年' },
  { value: '2025', label: '2025 年' },
  { value: '2026', label: '2026 年' },
]
const PERIOD_OPTIONS = [
  { value: '', label: '全年' },
  { value: 'Q1', label: 'Q1（1~3月）' },
  { value: 'Q2', label: 'Q2（4~6月）' },
  { value: 'Q3', label: 'Q3（7~9月）' },
  { value: 'Q4', label: 'Q4（10~12月）' },
]
const STATUS_OPTIONS = [
  { value: 'all', label: '全部狀態' },
  { value: '未決', label: '未決' },
  { value: '已決', label: '已決' },
  { value: '銷案', label: '銷案' },
]

interface CaseItem {
  id: number
  caseNumber: string
  departmentName: string
  insuranceCompanyName: string
  insuranceContact: string | null
  brokerCompanyName: string | null
  policyNumber: string
  insuredName: string
  incidentDate: string
  commissionDate: string
  closeDate: string | null
  status: string
  currentStage: string
  actualFee: number | null
  finalAmount: number | null
  travelOtherExpenseTotal: number
  primaryHandlerName: string
}

export default function CaseQueryPage() {
  const router = useRouter()
  useAuth()
  const filterBarRef = useRef<HTMLDivElement>(null)
  const [offsetHeader, setOffsetHeader] = useState(185)

  const [cases, setCases] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterYear, setFilterYear] = useState('')
  const [filterPeriod, setFilterPeriod] = useState('')
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [incidentDateFrom, setIncidentDateFrom] = useState('')
  const [incidentDateTo, setIncidentDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)

  // Sticky filter bar height
  useEffect(() => {
    const el = filterBarRef.current
    if (!el) return
    const measure = () => setOffsetHeader(el.offsetHeight + 64)
    const id = requestAnimationFrame(measure)
    const obs = new ResizeObserver(measure)
    obs.observe(el)
    return () => { cancelAnimationFrame(id); obs.disconnect() }
  }, [])

  const loadCases = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ status: filterStatus, pageSize: '200' })
    if (search) params.set('q', search)
    if (incidentDateFrom) params.set('incidentDateFrom', incidentDateFrom)
    if (incidentDateTo) params.set('incidentDateTo', incidentDateTo)
    if (filterYear) params.set('year', filterYear)
    if (filterYear && filterPeriod) params.set('quarter', filterPeriod)
    const res = await api.get<CaseItem[]>(`/api/cases?${params.toString()}`)
    if (res.success && res.data) setCases(res.data)
    setLoading(false)
  }, [search, filterStatus, filterYear, filterPeriod, incidentDateFrom, incidentDateTo])

  useEffect(() => { loadCases() }, [loadCases])

  function handleDateChange(dates: [Dayjs | null, Dayjs | null] | null) {
    if (!dates || !dates[0]) {
      setDateRange(null)
      setIncidentDateFrom('')
      setIncidentDateTo('')
      return
    }
    const [start, end] = dates
    const effectiveEnd = end && end.isAfter(start!, 'day') ? end : start!
    setDateRange([start, effectiveEnd])
    setIncidentDateFrom(start!.format('YYYY-MM-DD'))
    setIncidentDateTo(effectiveEnd.format('YYYY-MM-DD'))
  }

  function handleReset() {
    setSearch('')
    setFilterStatus('all')
    setFilterYear('')
    setFilterPeriod('')
    setDateRange(null)
    setIncidentDateFrom('')
    setIncidentDateTo('')
    setPage(1)
  }

  // 匯出 Excel（彷照「工程113(24K)」格式，欄位 A~V；匯出整個查詢結果）
  async function handleExport() {
    setExporting(true)
    try {
      const params = new URLSearchParams({ status: filterStatus })
      if (search) params.set('q', search)
      if (incidentDateFrom) params.set('incidentDateFrom', incidentDateFrom)
      if (incidentDateTo) params.set('incidentDateTo', incidentDateTo)
      if (filterYear) params.set('year', filterYear)
      if (filterYear && filterPeriod) params.set('quarter', filterPeriod)
      const res = await fetch(`/api/cases/export?${params.toString()}`, { credentials: 'include' })
      if (!res.ok) { message.error('匯出失敗，請稍後再試'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `案件查詢_${dayjs().format('YYYYMMDD')}.xlsx`
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

  // 統計
  const summary = useMemo(() => ({
    count: cases.length,
    totalFee: cases.reduce((s, c) => s + (c.actualFee ?? 0), 0),
    totalTravel: cases.reduce((s, c) => s + (c.travelOtherExpenseTotal ?? 0), 0),
  }), [cases])

  const columns = [
    {
      title: '公證編號', dataIndex: 'caseNumber', key: 'caseNumber', width: 160, fixed: 'left' as const,
      // [2026/06/18] - Lisa - 帶 from=settlements：點入案件明細時左側選單仍 highlight「案件查詢」
      render: (v: string, r: CaseItem) => (
        <a onClick={() => router.push(`/cases/${r.id}?from=settlements`)} style={{ color: '#1B4F8C', fontWeight: 600 }}>
          {v}
        </a>
      ),
    },
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName', width: 130, ellipsis: true },
    {
      title: '保險公司 (承辦人)', key: 'ic', width: 170, ellipsis: true,
      render: (_: unknown, r: CaseItem) =>
        r.insuranceContact ? `${r.insuranceCompanyName} (${r.insuranceContact})` : r.insuranceCompanyName,
    },
    {
      title: '保單號碼', dataIndex: 'policyNumber', key: 'policyNumber', width: 140, ellipsis: true,
      render: (v: string) => v || '—',
    },
    { title: '部門', dataIndex: 'departmentName', key: 'dept', width: 110, ellipsis: true },
    { title: '承辦人', dataIndex: 'primaryHandlerName', key: 'handler', width: 80 },
    {
      title: '委託日', dataIndex: 'commissionDate', key: 'commissionDate', width: 100,
      render: (v: string) => dayjs(v).format('YYYY/MM/DD'),
    },
    {
      title: '出險日期', dataIndex: 'incidentDate', key: 'incidentDate', width: 100,
      render: (v: string) => dayjs(v).format('YYYY/MM/DD'),
    },
    {
      title: '結案日', dataIndex: 'closeDate', key: 'closeDate', width: 100,
      render: (v: string | null) => v ? dayjs(v).format('YYYY/MM/DD') : '—',
    },
    {
      title: '最終金額', dataIndex: 'finalAmount', key: 'finalAmount', width: 110, align: 'right' as const,
      render: (v: number | null) => v != null ? `$${v.toLocaleString()}` : '—',
    },
    {
      title: '狀態', dataIndex: 'status', key: 'status', width: 70,
      render: (v: string) => (
        <Tag color={v === '已決' ? 'green' : v === '銷案' ? 'default' : 'blue'}>{v}</Tag>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      {/* ── Sticky 篩選列 ── */}
      <div
        ref={filterBarRef}
        style={{
          position: 'sticky', top: 64, zIndex: 20,
          background: '#F5F7FA', paddingBottom: 12, marginBottom: 4,
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
          <Col><Title level={4} style={{ margin: 0 }}>案件查詢</Title></Col>
          <Col>
            <Button
              icon={<FileExcelOutlined />}
              onClick={handleExport}
              loading={exporting}
              disabled={!cases.length}
            >
              匯出 Excel
            </Button>
          </Col>
        </Row>
        <Card size="small">
          <Row gutter={[8, 8]} align="bottom">
            <Col flex="280px">
              <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>
                可搜尋：公證編號 / 被保險人 / 保險公司 / 保單號碼
              </div>
              <Input.Search
                placeholder="公證編號 / 被保險人 / 保險公司 / 保單號碼"
                value={search}
                onSearch={v => { setSearch(v); setPage(1) }}
                onChange={e => !e.target.value && setSearch('')}
                allowClear
              />
            </Col>
            <Col>
              <Select
                value={filterStatus}
                onChange={v => { setFilterStatus(v); setPage(1) }}
                options={STATUS_OPTIONS}
                style={{ width: 110 }}
              />
            </Col>
            <Col>
              <DatePicker.RangePicker
                placeholder={['出險日期起', '出險日期迄']}
                value={dateRange}
                onChange={dates => handleDateChange(dates as [Dayjs | null, Dayjs | null] | null)}
                format="YYYY/MM/DD"
                style={{ width: 232 }}
              />
            </Col>
            <Col>
              <Select
                value={filterYear}
                onChange={v => { setFilterYear(v); setFilterPeriod(''); setPage(1) }}
                options={YEAR_OPTIONS}
                style={{ width: 110 }}
              />
            </Col>
            <Col>
              <Select
                value={filterPeriod}
                onChange={v => { setFilterPeriod(v); setPage(1) }}
                options={PERIOD_OPTIONS}
                style={{ width: 130 }}
                disabled={!filterYear}
              />
            </Col>
            <Col>
              <Button onClick={handleReset}>重置</Button>
            </Col>
          </Row>
        </Card>
      </div>

      {/* ── 統計卡 ── */}
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={8}>
          <Card size="small" styles={{ body: { padding: '8px 16px' } }}>
            <Statistic
              title="件數"
              value={summary.count}
              suffix="件"
              valueStyle={{ color: '#52c41a', fontSize: 20 }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" styles={{ body: { padding: '8px 16px' } }}>
            <Statistic
              title="公證費合計"
              value={summary.totalFee}
              prefix="$"
              formatter={v => Number(v).toLocaleString()}
              valueStyle={{ color: '#1890ff', fontSize: 20 }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" styles={{ body: { padding: '8px 16px' } }}>
            <Statistic
              title="差旅其他費合計"
              value={summary.totalTravel}
              prefix="$"
              formatter={v => Number(v).toLocaleString()}
              valueStyle={{ fontSize: 20 }}
            />
          </Card>
        </Col>
      </Row>

      {/* ── 案件清單 ── */}
      <Table
        dataSource={cases}
        columns={columns}
        rowKey="id"
        size="small"
        loading={loading}
        scroll={{ x: 1300 }}
        sticky={{ offsetHeader }}
        pagination={{
          current: page, pageSize: 15,
          total: cases.length,
          onChange: p => setPage(p),
          showTotal: t => `共 ${t} 筆`,
        }}
      />
    </div>
  )
}
