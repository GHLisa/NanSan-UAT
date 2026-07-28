'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table, Button, Input, Select, DatePicker, Tag, Typography, Row, Col, Card, Tooltip, Space,
} from 'antd'
import { PlusOutlined, WarningOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'

const { Title } = Typography
const { Search } = Input

const CASE_STAGES = [
  '進件/建檔', '初步報告', '理算表', '發函', '中間報告',
  '理算說明/協商', '正式結案報告', '請款單填寫', '結案',
]
const STAGE_OPTIONS = [{ value: '', label: '全部階段' }, ...CASE_STAGES.map(s => ({ value: s, label: s }))]

const SLA_INFO = {
  green:  { emoji: '🟢', text: '正常', color: '#52c41a' },
  yellow: { emoji: '🟡', text: '黃燈預警', color: '#faad14' },
  red:    { emoji: '🔴', text: '紅燈預警', color: '#ff4d4f' },
}

const PARKING_COLOR: Record<string, string> = { '訴訟中': 'red', '申訴中': 'orange', '待請求時效': 'blue' }

interface CaseItem {
  id: number
  caseNumber: string
  departmentId: number
  departmentName: string
  insuranceCompanyId: number
  insuranceCompanyName: string
  insuranceContact: string | null
  brokerCompanyName: string | null
  policyNumber: string
  insuredName: string
  insuranceType: string
  incidentLocation: string
  incidentDate: string
  commissionDate: string
  status: string
  currentStage: string
  parkingStatus: string | null
  estimatedAmount: number | null
  daysSince: number
  slaStatus: 'green' | 'yellow' | 'red'
  primaryHandlerName: string
  handlers: { id: number; name: string; role: string }[]
  hasRejectedReview: boolean
  // [2026/06/18] - Lisa - Issue #9 退件涵蓋全關卡，附關卡別 gate
  rejectedReviews: { documentType: string; gate: string; reviewRemarks: string | null }[]
  hasPendingReview: boolean
  hasMergedBilling: boolean // [2026/07/15] - Lisa - 合併送審旗標（結案報告書隨附 DEBIT NOTE）
}

interface MetaData {
  departments: { id: number; name: string }[]
  employees: { id: number; name: string }[]
}

function getDefaultFilters(role: string, empId: number, deptId: number | null) {
  // [2026/06/18] - Lisa - Issue #5 承辦人不限部門（可能於他部門協辦），不帶 deptId 預設 - Start
  // FR-34：承辦人預設「自己承辦未決」；不限部門以與導覽 badge myCaseCount 一致
  if (role === 'handler') {
    return { assigneeId: String(empId), deptId: '' }
  }
  // [2026/06/18] - Lisa - Issue #5 承辦人不限部門 - end
  // FR-34：組長 預設「自己承辦未決」（本部門）
  if (role === 'team_lead') {
    return { assigneeId: String(empId), deptId: deptId ? String(deptId) : '' }
  }
  // [2026/06/18] - Lisa - 行政人員代為：不預設承辦人；有部門限本部門、無部門全公司
  // 部門主管 / 行政人員 預設「本部門全部」（行政人員無部門→全公司，deptId 空字串不送）
  if (role === 'dept_manager' || role === 'admin_staff') {
    return { assigneeId: '', deptId: deptId ? String(deptId) : '' }
  }
  // 執行副總 / 系統管理員 預設「全公司」
  return { assigneeId: '', deptId: '' }
}

export default function CasesPage() {
  const router = useRouter()
  const { session } = useAuth()
  const filterBarRef = useRef<HTMLDivElement>(null)
  const [offsetHeader, setOffsetHeader] = useState(185)

  const defaults = session
    ? getDefaultFilters(session.role, parseInt(session.sub), session.departmentId)
    : { assigneeId: '', deptId: '' }

  const [filters, setFilters] = useState({
    q: '',
    stage: '',
    deptId: defaults.deptId,
    assigneeId: defaults.assigneeId,
    incidentDateFrom: '',
    incidentDateTo: '',
    page: 1,
    pageSize: 15,
  })
  const [cases, setCases] = useState<CaseItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState<MetaData>({ departments: [], employees: [] })
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  // [2026/07/09] - Lisa - 案件列表分頁/篩選狀態以 sessionStorage 保存，返回列表可重現篩選後狀態
  const [restored, setRestored] = useState(false)
  const listStateKey = session ? `nansan_cases_list:${session.sub}:${session.role}:${session.departmentId ?? ''}` : ''

  // [2026/06/18] - Lisa - 行政人員無部門＝全公司，視為 wide（可選任一部門/承辦人篩選）
  const isWide = !!session && (['vp', 'sysadmin'].includes(session.role) || (session.role === 'admin_staff' && !session.departmentId))
  const isHandler = session?.role === 'handler'
  const canCreate = !!session // [2026/07/01] Lisa - 新增案件開放所有角色

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

  useEffect(() => {
    api.get<MetaData>('/api/meta').then(res => { if (res.success && res.data) setMeta(res.data) })
  }, [])

  // [2026/07/09] - Lisa - 掛載時還原 sessionStorage 保存的分頁/篩選狀態（僅還原一次）
  useEffect(() => {
    if (!listStateKey) return
    try {
      const saved = sessionStorage.getItem(listStateKey)
      if (saved) {
        const parsed = JSON.parse(saved) as { filters?: typeof filters; dateRange?: [string | null, string | null] | null }
        if (parsed.filters) setFilters(parsed.filters)
        if (parsed.dateRange && parsed.dateRange[0]) {
          setDateRange([dayjs(parsed.dateRange[0]), dayjs(parsed.dateRange[1] ?? parsed.dateRange[0])])
        }
      }
    } catch { /* 忽略毀損的快取 */ }
    setRestored(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listStateKey])

  // [2026/07/09] - Lisa - 狀態變動即寫回 sessionStorage（還原完成後才寫，避免以預設值覆蓋既有快取）
  useEffect(() => {
    if (!restored || !listStateKey) return
    const payload = {
      filters,
      dateRange: dateRange ? [dateRange[0]?.format('YYYY-MM-DD') ?? null, dateRange[1]?.format('YYYY-MM-DD') ?? null] : null,
    }
    sessionStorage.setItem(listStateKey, JSON.stringify(payload))
  }, [filters, dateRange, restored, listStateKey])

  const loadCases = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ status: '未決' })
    if (filters.q) params.set('q', filters.q)
    if (filters.stage) params.set('stage', filters.stage)
    if (filters.deptId) params.set('deptId', filters.deptId)
    if (filters.assigneeId) params.set('assigneeId', filters.assigneeId)
    if (filters.incidentDateFrom) params.set('incidentDateFrom', filters.incidentDateFrom)
    if (filters.incidentDateTo) params.set('incidentDateTo', filters.incidentDateTo)
    params.set('page', String(filters.page))
    params.set('pageSize', String(filters.pageSize))
    const res = await api.get<CaseItem[]>(`/api/cases?${params.toString()}`)
    if (res.success && res.data) {
      setCases(res.data)
      setTotal((res as { total?: number }).total ?? res.data.length)
    }
    setLoading(false)
  }, [filters])

  useEffect(() => { if (restored) loadCases() }, [loadCases, restored])

  function resetFilters() {
    setFilters({ q: '', stage: '', deptId: defaults.deptId, assigneeId: defaults.assigneeId, incidentDateFrom: '', incidentDateTo: '', page: 1, pageSize: 15 })
    setDateRange(null)
  }

  function handleDateChange(dates: [Dayjs | null, Dayjs | null] | null) {
    if (!dates || !dates[0]) {
      setDateRange(null)
      setFilters(f => ({ ...f, incidentDateFrom: '', incidentDateTo: '', page: 1 }))
      return
    }
    const [start, end] = dates
    const effectiveEnd = end && end.isAfter(start!, 'day') ? end : start!
    setDateRange([start, effectiveEnd])
    setFilters(f => ({
      ...f,
      incidentDateFrom: start!.format('YYYY-MM-DD'),
      incidentDateTo: effectiveEnd.format('YYYY-MM-DD'),
      page: 1,
    }))
  }

  // Dept options: wide roles see all, others see own dept
  const deptOptions = isWide
    ? [{ value: '', label: '全部部門' }, ...meta.departments.map(d => ({ value: String(d.id), label: d.name }))]
    : meta.departments.filter(d => String(d.id) === defaults.deptId).map(d => ({ value: String(d.id), label: d.name }))

  // 部門篩選被限制在單一部門（僅一個選項）時，清單毋需再顯示部門欄；多選項（如執行副總）才保留
  const showDeptColumn = deptOptions.length > 1

  const assigneeOptions = isWide
    ? [{ value: '', label: '全部承辦人' }, ...meta.employees.map(e => ({ value: String(e.id), label: e.name }))]
    : [{ value: '', label: '全部' }, ...meta.employees.map(e => ({ value: String(e.id), label: e.name }))]

  const columns = [
    {
      title: 'SLA', key: 'sla', width: 70, align: 'center' as const, fixed: 'left' as const,
      render: (_: unknown, r: CaseItem) => {
        const info = SLA_INFO[r.slaStatus]
        const inner = (
          <div style={{ textAlign: 'center', lineHeight: 1.3 }}>
            <div style={{ fontSize: 16 }}>{info.emoji}</div>
            <div style={{ fontSize: 11, color: info.color, fontWeight: r.slaStatus !== 'green' ? 700 : 400 }}>
              D+{r.daysSince}
            </div>
          </div>
        )
        return r.slaStatus === 'green' ? inner : <Tooltip title={info.text}>{inner}</Tooltip>
      },
    },
    {
      title: '公證編號', dataIndex: 'caseNumber', key: 'caseNumber', width: 155, fixed: 'left' as const,
      render: (v: string, r: CaseItem) => (
        <a onClick={() => router.push(`/cases/${r.id}`)} style={{ color: '#1B4F8C', fontWeight: 600 }}>{v}</a>
      ),
    },
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName', width: 150, ellipsis: true },
    {
      title: '保險公司 (承辦人)', key: 'ic', width: 170, ellipsis: true,
      render: (_: unknown, r: CaseItem) =>
        r.insuranceContact ? `${r.insuranceCompanyName} (${r.insuranceContact})` : r.insuranceCompanyName,
    },
    {
      title: '保單號碼', dataIndex: 'policyNumber', key: 'policyNumber', width: 140, ellipsis: true,
      render: (v: string) => v || '—',
    },
    {
      title: '險種', dataIndex: 'insuranceType', key: 'insuranceType', width: 120, ellipsis: true,
      render: (v: string) => v || '—',
    },
    {
      title: '出險地點', dataIndex: 'incidentLocation', key: 'incidentLocation', width: 140, ellipsis: true,
      render: (v: string) => v || '—',
    },
    {
      title: '保代/保經', dataIndex: 'brokerCompanyName', key: 'broker', width: 120, ellipsis: true,
      render: (v: string | null) => v ?? '—',
    },
    ...(showDeptColumn ? [{ title: '部門', dataIndex: 'departmentName', key: 'dept', width: 100, ellipsis: true }] : []),
    {
      title: '承辦人', key: 'handler', width: 130, ellipsis: true,
      render: (_: unknown, r: CaseItem) => {
        const co = r.handlers.filter(h => h.role !== '主辦').map(h => h.name)
        return [r.primaryHandlerName, ...co].join(' / ')
      },
    },
    {
      title: '委託日', dataIndex: 'commissionDate', key: 'commissionDate', width: 100,
      render: (v: string) => dayjs(v).format('YYYY/MM/DD'),
    },
    {
      title: '出險日期', dataIndex: 'incidentDate', key: 'incidentDate', width: 100,
      render: (v: string) => dayjs(v).format('YYYY/MM/DD'),
    },
    {
      title: '目前階段', dataIndex: 'currentStage', key: 'stage', width: 180, ellipsis: true,
      // [2026/07/16] - Lisa - 合併送審：「併DN」改標於「目前階段」欄，與文件審核清單一致
      render: (v: string, r: CaseItem) => (
        <span style={{ whiteSpace: 'nowrap' }}>
          {/* [2026/07/16] - Lisa - 階段名稱過長時以 Tooltip 顯示全文（欄位截斷「…」補救） */}
          <Tooltip title={v}>{v}</Tooltip>
          {r.hasMergedBilling && (
            <Tooltip title="結案報告書已合併「公證費 DEBIT NOTE」一併送審（節點7、8）">
              <Tag color="blue" style={{ fontSize: 10, marginLeft: 4, cursor: 'default' }}>併DN</Tag>
            </Tooltip>
          )}
        </span>
      ),
    },
    {
      title: '預估金額', dataIndex: 'estimatedAmount', key: 'estimatedAmount', width: 120, align: 'right' as const,
      render: (v: number | null) => (
        <span style={{ whiteSpace: 'nowrap' }}>{v ? `$${v.toLocaleString()}` : '—'}</span>
      ),
    },
    {
      title: '狀態', key: 'status', width: 180,
      render: (_: unknown, r: CaseItem) => (
        <Space size={4} wrap>
          <Tag color={r.status === '已決' ? 'green' : r.status === '銷案' ? 'default' : 'blue'}>{r.status}</Tag>
          {r.parkingStatus && (
            <Tag color={PARKING_COLOR[r.parkingStatus] ?? 'default'}>{r.parkingStatus}</Tag>
          )}
          {r.hasRejectedReview && (
            <Tooltip title={
              <span style={{ whiteSpace: 'pre-line' }}>
                {/* [2026/06/18] - Lisa - Issue #9 標示退回關卡別 */}
                {r.rejectedReviews.map(rj => `【${rj.documentType}・${rj.gate}退回】${rj.reviewRemarks ?? ''}`).join('\n')}
              </span>
            }>
              <Tag color="orange" icon={<WarningOutlined />} style={{ cursor: 'default' }}>退件</Tag>
            </Tooltip>
          )}
          {r.hasPendingReview && (
            <Tag color="blue" icon={<ClockCircleOutlined />} style={{ cursor: 'default' }}>審核中</Tag>
          )}
          {/* [2026/07/16] - Lisa - 合併送審：「併DN」已移至「目前階段」欄呈現 */}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      {/* ── Sticky filter bar ── */}
      <div
        ref={filterBarRef}
        style={{ position: 'sticky', top: 64, zIndex: 20, background: '#F5F7FA', paddingBottom: 12, marginBottom: 4 }}
      >
        <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
          <Col><Title level={4} style={{ margin: 0 }}>案件管理</Title></Col>
          <Col>
            {canCreate && (
              <Button type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C' }}
                onClick={() => router.push('/cases/new')}>
                新增案件
              </Button>
            )}
          </Col>
        </Row>

        <Card size="small">
          {/* 第一列 */}
          <Row gutter={[8, 8]} align="bottom" style={{ marginBottom: 8 }}>
            {/* [2026/07/28] - Lisa - 提示文字加入「保代保經」後變長，加寬欄位並禁止折行 */}
            <Col flex="340px">
              <div style={{ fontSize: 11, color: '#888', marginBottom: 2, whiteSpace: 'nowrap' }}>
                可搜尋：公證編號 / 被保險人 / 保險公司 / 保單號碼 / 保代保經
              </div>
              <Search
                placeholder="關鍵字搜尋"
                onSearch={v => setFilters(f => ({ ...f, q: v, page: 1 }))}
                onChange={e => !e.target.value && setFilters(f => ({ ...f, q: '', page: 1 }))}
                allowClear
              />
            </Col>
            <Col>
              <Select
                value={filters.stage} onChange={v => setFilters(f => ({ ...f, stage: v, page: 1 }))}
                options={STAGE_OPTIONS} style={{ width: 145 }} />
            </Col>
            <Col>
              <DatePicker.RangePicker
                placeholder={['出險日期起', '出險日期迄']}
                value={dateRange}
                onChange={(dates) => handleDateChange(dates as [Dayjs | null, Dayjs | null] | null)}
                format="YYYY/MM/DD"
                inputReadOnly={false}
                style={{ width: 232 }}
              />
            </Col>
            <Col>
              <Button onClick={resetFilters}>重置</Button>
            </Col>
          </Row>
          {/* 第二列（承辦人角色不顯示） */}
          {!isHandler && (
            <Row gutter={[8, 8]} align="middle">
              <Col>
                <Select
                  value={filters.deptId} onChange={v => setFilters(f => ({ ...f, deptId: v, page: 1 }))}
                  options={deptOptions} style={{ width: 145 }} />
              </Col>
              <Col>
                <Select
                  value={filters.assigneeId} onChange={v => setFilters(f => ({ ...f, assigneeId: v, page: 1 }))}
                  options={assigneeOptions} style={{ width: 135 }}
                  showSearch optionFilterProp="label" />
              </Col>
            </Row>
          )}
        </Card>
      </div>

      {/* ── 主表格 ── */}
      <div style={{ isolation: 'isolate' }}>
        <Table
          dataSource={cases}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          scroll={{ x: showDeptColumn ? 1830 : 1730 }}
          sticky={{ offsetHeader }}
          rowClassName={(r: CaseItem) => r.hasRejectedReview ? 'row-rejected' : ''}
          pagination={{
            current: filters.page,
            pageSize: filters.pageSize,
            total,
            onChange: (page, pageSize) => setFilters(f => ({ ...f, page, pageSize })),
            showTotal: t => `共 ${t} 筆`,
          }}
        />
      </div>

      <style>{`
        .row-rejected td { background: #fff7e6 !important; }
        .row-rejected:hover td { background: #ffefd6 !important; }
      `}</style>
    </div>
  )
}
