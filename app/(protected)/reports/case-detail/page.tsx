'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Card, Typography, Tabs, Select, Table, Space, Button, message } from 'antd'
import { FileExcelOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title, Text } = Typography

// ── Constants ─────────────────────────────────────────────────────────────
// [2026/07/16] - Lisa - 年度下拉改依實際資料（所有已決案件的結案年度）動態產生，見 /api/meta closeYears
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1} 月` }))
const QUARTER_OPTIONS = [
  { value: 'Q1', label: 'Q1（1~3月）' },
  { value: 'Q2', label: 'Q2（4~6月）' },
  { value: 'Q3', label: 'Q3（7~9月）' },
  { value: 'Q4', label: 'Q4（10~12月）' },
]

const fmtFee = (v: number) => v > 0 ? `$${v.toLocaleString()}` : '—'
const fmtN   = (v: number) => v > 0 ? v : '—'

const GROUP_BG = ['#ffffff', '#F0F7FF']
const SUB_BG   = '#DBEAFE'
const TOTAL_BG = '#FFF7E6'

// ── Types ─────────────────────────────────────────────────────────────────
interface CaseRow { id: number; caseNumber: string; insuredName: string; closeDate: string; actualFee: number; travelFee: number; subtotalFee: number; remarks: string }
interface EmpGroup { empId: number; empName: string; cases: CaseRow[]; totals: { caseCount: number; actualFee: number; travelFee: number; subtotalFee: number } }
interface ReportData { type: string; year: number; month: number; quarter: string; groups: EmpGroup[]; grandTotals: { caseCount: number; actualFee: number; travelFee: number; subtotalFee: number }; ytdGroups: EmpGroup[] | null }

// ── Flat row builder for detail table ─────────────────────────────────────
type FlatRow = {
  key: string
  type: 'case' | 'subtotal' | 'separator'
  groupIdx: number
  seq?: number
  empName?: string
  caseNumber?: string
  insuredName?: string
  closeDate?: string
  actualFee?: number
  travelFee?: number
  subtotalFee?: number
  remarks?: string
  caseCount?: number
}

function buildFlatRows(groups: EmpGroup[]): FlatRow[] {
  const rows: FlatRow[] = []
  let seq = 1
  groups.forEach(({ empId, empName, cases, totals }, gi) => {
    const sorted = [...cases].sort((a, b) => (a.closeDate ?? '').localeCompare(b.closeDate ?? ''))
    sorted.forEach(c => {
      rows.push({ key: `c-${c.id}`, type: 'case', groupIdx: gi, seq: seq++, empName, caseNumber: c.caseNumber, insuredName: c.insuredName, closeDate: c.closeDate, actualFee: c.actualFee, travelFee: c.travelFee, subtotalFee: c.subtotalFee, remarks: c.remarks })
    })
    rows.push({ key: `s-${empId}`, type: 'subtotal', groupIdx: gi, empName, caseCount: totals.caseCount, actualFee: totals.actualFee, travelFee: totals.travelFee, subtotalFee: totals.subtotalFee })
    if (gi < groups.length - 1) {
      rows.push({ key: `sep-${gi}`, type: 'separator', groupIdx: gi })
    }
  })
  return rows
}

// ── Detail Table ──────────────────────────────────────────────────────────
const DETAIL_COLS = [
  { title: '序', key: 'seq', width: 44, align: 'center' as const,
    render: (_: unknown, r: FlatRow) => r.type !== 'case' ? null : r.seq },
  { title: '公證編號', key: 'caseNumber', width: 160,
    render: (_: unknown, r: FlatRow) => {
      if (r.type === 'subtotal') return <Text strong>小計（{r.caseCount} 件）</Text>
      if (r.type !== 'case') return null
      return r.caseNumber
    }},
  { title: '被保險人', key: 'insuredName', ellipsis: true,
    render: (_: unknown, r: FlatRow) => r.type !== 'case' ? null : r.insuredName },
  { title: '經辦人', key: 'empName', width: 80,
    render: (_: unknown, r: FlatRow) => r.type !== 'case' ? null : r.empName },
  { title: '出報告日期', key: 'closeDate', width: 110,
    render: (_: unknown, r: FlatRow) => r.type !== 'case' ? null : (r.closeDate ? dayjs(r.closeDate).format('YYYY/MM/DD') : '—') },
  { title: '純公證費', key: 'actualFee', width: 110, align: 'right' as const,
    render: (_: unknown, r: FlatRow) => {
      if (r.type === 'subtotal') return <Text strong>{fmtFee(r.actualFee ?? 0)}</Text>
      if (r.type !== 'case') return null
      return fmtFee(r.actualFee ?? 0)
    }},
  { title: '差旅其他費', key: 'travelFee', width: 110, align: 'right' as const,
    render: (_: unknown, r: FlatRow) => {
      if (r.type === 'subtotal') return <Text strong>{fmtFee(r.travelFee ?? 0)}</Text>
      if (r.type !== 'case') return null
      return fmtFee(r.travelFee ?? 0)
    }},
  { title: '小計', key: 'subtotalFee', width: 110, align: 'right' as const,
    render: (_: unknown, r: FlatRow) => {
      if (r.type === 'subtotal') return <Text strong>{fmtFee(r.subtotalFee ?? 0)}</Text>
      if (r.type !== 'case') return null
      return fmtFee(r.subtotalFee ?? 0)
    }},
  { title: '備註', key: 'remarks', width: 180,
    render: (_: unknown, r: FlatRow) => r.type !== 'case' || !r.remarks ? null
      : <Text type="secondary" style={{ fontSize: 12 }}>{r.remarks}</Text> },
]

function DetailTable({ groups, grandTotals }: { groups: EmpGroup[]; grandTotals: ReportData['grandTotals'] }) {
  const rows = useMemo(() => buildFlatRows(groups), [groups])
  if (rows.length === 0) return <Text type="secondary">查無已決案件資料。</Text>
  return (
    <Table
      dataSource={rows}
      columns={DETAIL_COLS}
      rowKey="key"
      size="small"
      pagination={false}
      scroll={{ x: 800 }}
      onRow={r => ({
        style: {
          background: r.type === 'separator' ? '#F5F7FA' : r.type === 'subtotal' ? SUB_BG : GROUP_BG[r.groupIdx % 2],
          height: r.type === 'separator' ? 10 : undefined,
        },
      })}
      summary={() => (
        <Table.Summary fixed>
          <Table.Summary.Row style={{ background: TOTAL_BG }}>
            <Table.Summary.Cell index={0} colSpan={2} align="left">
              <Text strong>合計（{grandTotals.caseCount} 件）</Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={2} /><Table.Summary.Cell index={3} /><Table.Summary.Cell index={4} />
            <Table.Summary.Cell index={5} align="right"><Text strong>{fmtFee(grandTotals.actualFee)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={6} align="right"><Text strong>{fmtFee(grandTotals.travelFee)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={7} align="right"><Text strong>{fmtFee(grandTotals.subtotalFee)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={8} />
          </Table.Summary.Row>
        </Table.Summary>
      )}
    />
  )
}

// ── Quarter Summary Table ─────────────────────────────────────────────────
const QUARTER_COLS = [
  { title: '序', dataIndex: 'seq', key: 'seq', width: 44, align: 'center' as const },
  { title: '經辦人', dataIndex: 'empName', key: 'empName', width: 100 },
  { title: '件數', dataIndex: 'caseCount', key: 'caseCount', width: 70, align: 'center' as const, render: (v: number) => fmtN(v) },
  { title: '純公證費', dataIndex: 'actualFee', key: 'actualFee', width: 130, align: 'right' as const, render: (v: number) => fmtFee(v) },
  { title: '差旅其他費', dataIndex: 'travelFee', key: 'travelFee', width: 120, align: 'right' as const, render: (v: number) => fmtFee(v) },
  { title: '小計', dataIndex: 'subtotalFee', key: 'subtotalFee', width: 130, align: 'right' as const, render: (v: number) => fmtFee(v) },
]

function QuarterTable({ groups }: { groups: EmpGroup[] }) {
  const rows = groups.map((g, i) => ({ key: g.empId, seq: i + 1, empName: g.empName, ...g.totals }))
  const grand = groups.reduce((s, g) => ({ caseCount: s.caseCount + g.totals.caseCount, actualFee: s.actualFee + g.totals.actualFee, travelFee: s.travelFee + g.totals.travelFee, subtotalFee: s.subtotalFee + g.totals.subtotalFee }), { caseCount: 0, actualFee: 0, travelFee: 0, subtotalFee: 0 })
  if (rows.length === 0) return <Text type="secondary">查無已決案件資料。</Text>
  return (
    <Table
      dataSource={rows} columns={QUARTER_COLS} rowKey="key"
      size="small" pagination={false}
      summary={() => (
        <Table.Summary fixed>
          <Table.Summary.Row style={{ background: TOTAL_BG }}>
            <Table.Summary.Cell index={0} colSpan={2} align="left"><Text strong>合計</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={2} align="center"><Text strong>{grand.caseCount}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={3} align="right"><Text strong>{fmtFee(grand.actualFee)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={4} align="right"><Text strong>{fmtFee(grand.travelFee)}</Text></Table.Summary.Cell>
            <Table.Summary.Cell index={5} align="right"><Text strong>{fmtFee(grand.subtotalFee)}</Text></Table.Summary.Cell>
          </Table.Summary.Row>
        </Table.Summary>
      )}
    />
  )
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function CaseDetailReportPage() {
  const { session } = useAuth()
  const role  = session?.role ?? ''
  const isWide = ['vp', 'sysadmin', 'admin_staff'].includes(role)

  const [filterYear,  setFilterYear]  = useState(dayjs().year())
  const [filterMonth, setFilterMonth] = useState(dayjs().month() + 1)
  const [filterQ,     setFilterQ]     = useState('Q1')
  const [filterDeptId, setFilterDeptId] = useState<number | null>(null)
  const [monthData,   setMonthData]   = useState<ReportData | null>(null)
  const [quarterData, setQuarterData] = useState<ReportData | null>(null)
  const [loadingM, setLoadingM] = useState(false)
  const [loadingQ, setLoadingQ] = useState(false)
  const [exportingM, setExportingM] = useState(false)
  const [exportingQ, setExportingQ] = useState(false)

  const [depts, setDepts] = useState<{ id: number; name: string }[]>([])
  // [2026/07/16] - Lisa - 已決案結案年度（動態），不再固定近三年
  const [closeYears, setCloseYears] = useState<number[]>([])
  useEffect(() => {
    api.get<{ departments: { id: number; name: string }[]; closeYears: number[] }>('/api/meta').then(res => {
      if (res.success && res.data) {
        setDepts(res.data.departments)
        setCloseYears(res.data.closeYears ?? [])
      }
    })
  }, [])

  // 年度下拉：依系統實際已決案結案年度（由新到舊）；未載入前先以當年度墊檔
  const yearOptions = useMemo(() => {
    const years = closeYears.length ? closeYears : [dayjs().year()]
    return years.map(y => ({ value: y, label: `${y} 年` }))
  }, [closeYears])

  const loadMonth = useCallback(async () => {
    setLoadingM(true)
    const p = new URLSearchParams({ type: 'monthly', year: String(filterYear), month: String(filterMonth) })
    if (filterDeptId) p.set('deptId', String(filterDeptId))
    const res = await api.get<ReportData>(`/api/reports/case-detail?${p}`)
    if (res.success && res.data) setMonthData(res.data)
    setLoadingM(false)
  }, [filterYear, filterMonth, filterDeptId])

  const loadQuarter = useCallback(async () => {
    setLoadingQ(true)
    const p = new URLSearchParams({ type: 'quarterly', year: String(filterYear), quarter: filterQ })
    if (filterDeptId) p.set('deptId', String(filterDeptId))
    const res = await api.get<ReportData>(`/api/reports/case-detail?${p}`)
    if (res.success && res.data) setQuarterData(res.data)
    setLoadingQ(false)
  }, [filterYear, filterQ, filterDeptId])

  useEffect(() => { loadMonth() }, [loadMonth])
  useEffect(() => { loadQuarter() }, [loadQuarter])

  // 匯出 Excel（依當前分頁條件下載對應檔案）
  async function downloadExport(params: URLSearchParams, fname: string) {
    const res = await fetch(`/api/reports/case-detail/export?${params}`, { credentials: 'include' })
    if (!res.ok) { message.error('匯出失敗，請稍後再試'); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fname
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function handleExportMonth() {
    setExportingM(true)
    try {
      const p = new URLSearchParams({ type: 'monthly', year: String(filterYear), month: String(filterMonth) })
      if (filterDeptId) p.set('deptId', String(filterDeptId))
      await downloadExport(p, `已決案明細表_${filterYear}${String(filterMonth).padStart(2, '0')}_${dayjs().format('YYYYMMDD')}.xlsx`)
    } catch {
      message.error('匯出失敗，請稍後再試')
    } finally {
      setExportingM(false)
    }
  }

  async function handleExportQuarter() {
    setExportingQ(true)
    try {
      const p = new URLSearchParams({ type: 'quarterly', year: String(filterYear), quarter: filterQ })
      if (filterDeptId) p.set('deptId', String(filterDeptId))
      await downloadExport(p, `已決案明細表_${filterYear}${filterQ}_${dayjs().format('YYYYMMDD')}.xlsx`)
    } catch {
      message.error('匯出失敗，請稍後再試')
    } finally {
      setExportingQ(false)
    }
  }

  const deptSelect = isWide && (
    <Select
      value={filterDeptId}
      onChange={setFilterDeptId}
      options={[{ value: null, label: '全部部門' }, ...depts.map(d => ({ value: d.id, label: d.name }))]}
      style={{ width: 150 }}
    />
  )

  const tabItems = [
    {
      key: '1',
      label: '月統計',
      children: (
        <>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space wrap>
              <Select value={filterYear} onChange={setFilterYear} options={yearOptions} style={{ width: 100 }} />
              <Select value={filterMonth} onChange={setFilterMonth} options={MONTH_OPTIONS} style={{ width: 80 }} />
              {deptSelect}
              <Button
                color="green"
                variant="solid"
                icon={<FileExcelOutlined />}
                onClick={handleExportMonth}
                loading={exportingM}
                disabled={loadingM || !monthData?.groups.length}
              >
                匯出 Excel
              </Button>
            </Space>
          </Card>
          {loadingM
            ? <Text type="secondary">載入中...</Text>
            : monthData
              ? <DetailTable groups={monthData.groups} grandTotals={monthData.grandTotals} />
              : null}
        </>
      ),
    },
    {
      key: '2',
      label: '季統計',
      children: (
        <>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space wrap>
              <Select value={filterYear} onChange={setFilterYear} options={yearOptions} style={{ width: 100 }} />
              <Select value={filterQ} onChange={setFilterQ} options={QUARTER_OPTIONS} style={{ width: 140 }} />
              {deptSelect}
              <Button
                color="green"
                variant="solid"
                icon={<FileExcelOutlined />}
                onClick={handleExportQuarter}
                loading={exportingQ}
                disabled={loadingQ || !quarterData?.groups.length}
              >
                匯出 Excel
              </Button>
            </Space>
          </Card>
          {loadingQ ? <Text type="secondary">載入中...</Text> : quarterData && (
            <>
              <Card size="small" title={`${filterYear} 年 ${filterQ} 已決案統計`} style={{ marginBottom: 16 }}>
                <QuarterTable groups={quarterData.groups} />
              </Card>
              <Card size="small" title={`${filterYear} 年 Q1 ~ ${filterQ} 累計已決案統計`}>
                <QuarterTable groups={quarterData.ytdGroups ?? []} />
              </Card>
            </>
          )}
        </>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Tabs
        items={tabItems}
        renderTabBar={(props, DefaultTabBar) => (
          <div style={{ position: 'sticky', top: 64, zIndex: 50, background: '#F5F7FA', paddingTop: 16 }}>
            <Title level={4} style={{ margin: '0 0 4px' }}>已決案明細表</Title>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              註：純公證費依承辦比例分配至各經辦人、差旅其他費歸主辦；同一案分列於各經辦人，件數依參與人計。
            </Text>
            <DefaultTabBar {...props} style={{ marginBottom: 0 }} />
          </div>
        )}
      />
    </div>
  )
}
