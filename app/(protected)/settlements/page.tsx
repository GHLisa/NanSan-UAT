'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table, Card, Row, Col, Typography, Tag, Select, Button, Statistic, Input, DatePicker, message,
  Modal, Alert, Tooltip,
} from 'antd'
import { FileExcelOutlined, DeleteOutlined } from '@ant-design/icons'
import { api, type ApiResponse } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'

const { Title } = Typography

const PAGE_SIZE = 15

// [2026/07/27] - Lisa - 委託日年度：保留「全部年份」選項（可跨年度查詢），但預設值改為當年度
const CURRENT_YEAR = new Date().getFullYear()
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

// [2026/07/31] - Lisa - 銷案案件刪除可用角色（與 API DELETE_CANCELLED_ROLES 一致）：
// 部門主管／行政人員／系統管理員；不含執行副總。後端另依部門範圍再檢核一次。
const DELETE_CANCELLED_ROLES = ['dept_manager', 'admin_staff', 'sysadmin']

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
  prelimNoteStuckAtIntake: boolean // [2026/08/25] - Lisa - 備註提及初步報告但階段仍卡在進件，疑似未落實送審流程
  assignmentNotes: string | null // [2026/08/28] - Lisa - 交辦事項（清單欄位用；無則顯示「—」，有則滑鼠移至顯示全文）
}

export default function CaseQueryPage() {
  const router = useRouter()
  const { session } = useAuth()
  const filterBarRef = useRef<HTMLDivElement>(null)
  const [offsetHeader, setOffsetHeader] = useState(185)

  // 部門篩選僅對可跨部門角色（執行副總／系統管理員／無部門行政人員）有意義；
  // 其餘角色後端已依 buildCaseScope 限定本部門範圍，不另顯示篩選
  const isWide = !!session && (['vp', 'sysadmin'].includes(session.role) || (session.role === 'admin_staff' && !session.departmentId))

  const [cases, setCases] = useState<CaseItem[]>([])
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([])
  // [2026/07/16] - Lisa - 年度下拉改依實際資料（系統中所有案件的委託年度）動態產生
  const [caseYears, setCaseYears] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterDept, setFilterDept] = useState('')
  const [filterYear, setFilterYear] = useState(String(CURRENT_YEAR))
  const [filterPeriod, setFilterPeriod] = useState('')
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  const [incidentDateFrom, setIncidentDateFrom] = useState('')
  const [incidentDateTo, setIncidentDateTo] = useState('')
  const [filterIcId, setFilterIcId] = useState('')            // 保險公司（第一層）
  const [filterContacts, setFilterContacts] = useState<string[]>([])  // 保險公司承辦人（第二層多選）
  const [insuranceCompanies, setInsuranceCompanies] = useState<{ id: number; name: string }[]>([])
  const [contactOptions, setContactOptions] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState({ count: 0, totalFee: 0, totalTravel: 0 })
  const [exporting, setExporting] = useState(false)

  // [2026/07/31] - Lisa - 銷案案件刪除：刪除後資料移入封存表（deleted_cases），查詢／報表統計不再計入
  const canDeleteCancelled = !!session && DELETE_CANCELLED_ROLES.includes(session.role)
  const [deleteTarget, setDeleteTarget] = useState<CaseItem | null>(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleting, setDeleting] = useState(false)

  // 年度下拉：保留「全部年份」，其餘依系統實際委託年度（由新到舊）動態帶入
  const yearOptions = useMemo(
    () => [{ value: '', label: '全部年份' }, ...caseYears.map(y => ({ value: String(y), label: `${y} 年` }))],
    [caseYears],
  )

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
    api.get<{ departments: { id: number; name: string }[]; insuranceCompanies: { id: number; name: string }[]; caseYears: number[] }>('/api/meta').then(res => {
      if (res.success && res.data) {
        setDepartments(res.data.departments)
        setInsuranceCompanies(res.data.insuranceCompanies)
        setCaseYears(res.data.caseYears ?? [])
      }
    })
  }, [])

  // 選定保險公司後載入其承辦人選項（第二層連動）；未選則清空
  useEffect(() => {
    if (!filterIcId) { setContactOptions([]); return }
    api.get<string[]>(`/api/cases?mode=contacts&insuranceCompanyId=${filterIcId}`).then(res => {
      if (res.success && res.data) setContactOptions(res.data)
    })
  }, [filterIcId])

  const loadCases = useCallback(async () => {
    setLoading(true)
    // [2026/07/14] - Lisa - 改伺服器端分頁：只取當頁 15 筆；withSummary=1 讓後端回傳整個查詢範圍的
    // 全量件數與費用合計（不受分頁筆數影響），統計卡改用此摘要，避免舊版只加前 200 筆造成低估
    const params = new URLSearchParams({
      status: filterStatus,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      withSummary: '1',
    })
    if (search) params.set('q', search)
    if (filterDept) params.set('deptId', filterDept)
    if (incidentDateFrom) params.set('incidentDateFrom', incidentDateFrom)
    if (incidentDateTo) params.set('incidentDateTo', incidentDateTo)
    if (filterYear) params.set('year', filterYear)
    if (filterYear && filterPeriod) params.set('quarter', filterPeriod)
    if (filterIcId) params.set('insuranceCompanyId', filterIcId)
    if (filterContacts.length) params.set('contacts', filterContacts.join(','))
    const res = await api.get<CaseItem[]>(`/api/cases?${params.toString()}`) as ApiResponse<CaseItem[]> & {
      total?: number
      summary?: { count: number; totalFee: number; totalTravel: number }
    }
    if (res.success && res.data) {
      setCases(res.data)
      setTotal(res.total ?? res.data.length)
      if (res.summary) setSummary(res.summary)
    }
    setLoading(false)
  }, [search, filterStatus, filterDept, filterYear, filterPeriod, incidentDateFrom, incidentDateTo, filterIcId, filterContacts, page])

  useEffect(() => { loadCases() }, [loadCases])

  function handleDateChange(dates: [Dayjs | null, Dayjs | null] | null) {
    setPage(1)
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
    setSearchInput('')
    setFilterStatus('all')
    setFilterDept('')
    setFilterYear(String(CURRENT_YEAR))
    setFilterPeriod('')
    setDateRange(null)
    setIncidentDateFrom('')
    setIncidentDateTo('')
    setFilterIcId('')
    setFilterContacts([])
    setContactOptions([])
    setPage(1)
  }

  // 匯出 Excel（彷照「工程113(24K)」格式，欄位 A~V；匯出整個查詢結果）
  async function handleExport() {
    setExporting(true)
    try {
      const params = new URLSearchParams({ status: filterStatus })
      if (search) params.set('q', search)
      if (filterDept) params.set('deptId', filterDept)
      if (incidentDateFrom) params.set('incidentDateFrom', incidentDateFrom)
      if (incidentDateTo) params.set('incidentDateTo', incidentDateTo)
      if (filterYear) params.set('year', filterYear)
      if (filterYear && filterPeriod) params.set('quarter', filterPeriod)
      if (filterIcId) params.set('insuranceCompanyId', filterIcId)
      if (filterContacts.length) params.set('contacts', filterContacts.join(','))
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

  // [2026/07/31] - Lisa - 銷案案件刪除：原因必填，成功後重新載入清單（該筆已不在 cases 表，不會再出現）
  async function handleDelete() {
    if (!deleteTarget) return
    const reason = deleteReason.trim()
    if (!reason) { message.warning('請填寫刪除原因'); return }
    setDeleting(true)
    const res = await api.delete(`/api/cases/${deleteTarget.id}`, { deleteReason: reason })
    setDeleting(false)
    if (!res.success) { message.error(res.error ?? '刪除失敗'); return }
    message.success(`案件 ${deleteTarget.caseNumber} 已刪除，公證編號已釋出`)
    setDeleteTarget(null)
    setDeleteReason('')
    loadCases()
  }

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
    {
      // [2026/08/28] - Lisa - 交辦事項欄位：無顯示「—」，有則字數多改以滑鼠移至顯示全文（Tooltip）
      title: '交辦事項', key: 'assignmentNotes', width: 90, align: 'center' as const,
      render: (_: unknown, r: CaseItem) => (
        r.assignmentNotes ? (
          <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{r.assignmentNotes}</span>}>
            <Tag color="gold" style={{ cursor: 'default' }}>有</Tag>
          </Tooltip>
        ) : '—'
      ),
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
    // [2026/07/31] - Lisa - 刪除欄僅對可刪除角色顯示；按鈕僅在「銷案」案件出現（未決／已決不可刪）
    ...(canDeleteCancelled ? [{
      title: '刪除', key: 'delete', width: 60, align: 'center' as const, fixed: 'right' as const,
      render: (_: unknown, r: CaseItem) => r.status !== '銷案' ? null : (
        <Tooltip title="刪除銷案案件（資料移入封存表，公證編號釋出）">
          <Button
            type="text"
            danger
            size="small"
            icon={<DeleteOutlined />}
            onClick={() => { setDeleteTarget(r); setDeleteReason('') }}
          />
        </Tooltip>
      ),
    }] : []),
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
              color="green"
              variant="solid"
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
            {/* [2026/07/28] - Lisa - 提示文字加入「保代保經」後變長，加寬欄位並禁止折行 */}
            <Col flex="340px">
              <div style={{ fontSize: 11, color: '#888', marginBottom: 2, whiteSpace: 'nowrap' }}>
                可搜尋：公證編號 / 被保險人 / 保險公司 / 保單號碼 / 保代保經
              </div>
              <Input.Search
                placeholder="公證編號 / 被保險人 / 保險公司 / 保單號碼 / 保代保經"
                value={searchInput}
                onSearch={v => { setSearch(v); setPage(1) }}
                onChange={e => { setSearchInput(e.target.value); if (!e.target.value) { setSearch(''); setPage(1) } }}
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
            {isWide && (
              <Col>
                <Select
                  value={filterDept}
                  onChange={v => { setFilterDept(v); setPage(1) }}
                  options={[{ value: '', label: '全部部門' }, ...departments.map(d => ({ value: String(d.id), label: d.name }))]}
                  style={{ width: 145 }}
                  showSearch
                  optionFilterProp="label"
                />
              </Col>
            )}
            <Col>
              <Select
                value={filterIcId || undefined}
                onChange={v => { setFilterIcId(v ?? ''); setFilterContacts([]); setPage(1) }}
                options={insuranceCompanies.map(c => ({ value: String(c.id), label: c.name }))}
                placeholder="全部保險公司"
                style={{ width: 160 }}
                showSearch
                optionFilterProp="label"
                allowClear
              />
            </Col>
            <Col>
              <Select
                mode="multiple"
                value={filterContacts}
                onChange={vals => { setFilterContacts(vals); setPage(1) }}
                options={contactOptions.map(c => ({ value: c, label: c }))}
                placeholder={filterIcId ? '保險公司承辦人（可多選）' : '請先選保險公司'}
                style={{ minWidth: 200, maxWidth: 320 }}
                disabled={!filterIcId}
                showSearch
                optionFilterProp="label"
                maxTagCount="responsive"
                allowClear
                notFoundContent={filterIcId ? '此保險公司無承辦人資料' : null}
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
          </Row>
          {/* [2026/07/14] - Lisa - 委託日年度＋季別獨立為第二排，與上排查詢條件分開 */}
          <Row gutter={[8, 8]} align="bottom" style={{ marginTop: 8 }}>
            <Col>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#555', whiteSpace: 'nowrap' }}>委託日年度：</span>
                <Select
                  value={filterYear}
                  onChange={v => { setFilterYear(v); setFilterPeriod(''); setPage(1) }}
                  options={yearOptions}
                  style={{ width: 110 }}
                />
              </div>
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
              <Button color="primary" variant="solid" onClick={handleReset}>重置</Button>
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
        rowClassName={(r: CaseItem) => r.prelimNoteStuckAtIntake ? 'row-prelim-stuck' : ''}
        pagination={{
          current: page, pageSize: PAGE_SIZE,
          total,
          showSizeChanger: false,
          onChange: p => setPage(p),
          showTotal: t => `共 ${t} 筆`,
        }}
      />

      {/* [2026/08/25] - Lisa - 紅字列圖例說明 */}
      {cases.some(c => c.prelimNoteStuckAtIntake) && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#ff4d4f' }}>
          ● 紅字：備註曾提到「初步報告」，但流程階段仍卡在「進件/建檔」，可能未落實案件送審流程
        </div>
      )}

      <style>{`
        .row-prelim-stuck td { color: #ff4d4f !important; }
      `}</style>

      {/* ── [2026/07/31] - Lisa - 銷案案件刪除確認（原因必填）── */}
      <Modal
        title="刪除銷案案件"
        open={!!deleteTarget}
        onCancel={() => { setDeleteTarget(null); setDeleteReason('') }}
        onOk={handleDelete}
        okText="確認刪除"
        okButtonProps={{ danger: true, loading: deleting, disabled: !deleteReason.trim() }}
        cancelText="取消"
        destroyOnHidden
      >
        {deleteTarget && (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="刪除後不可從畫面復原"
              description={
                <span>
                  本案將自案件查詢與所有報表統計中移除且無法再查詢，完整資料保留於封存表供稽核追溯。
                  公證編號 <b>{deleteTarget.caseNumber}</b> 將釋出，可於建案時以人工填號重新使用。
                </span>
              }
            />
            <div style={{ marginBottom: 12, lineHeight: 1.9 }}>
              <div>公證編號：<b>{deleteTarget.caseNumber}</b></div>
              <div>被保險人：{deleteTarget.insuredName}</div>
              <div>保險公司：{deleteTarget.insuranceCompanyName}</div>
              <div>部門／承辦人：{deleteTarget.departmentName}／{deleteTarget.primaryHandlerName || '—'}</div>
            </div>
            <div style={{ marginBottom: 4 }}>
              刪除原因 <span style={{ color: '#ff4d4f' }}>*</span>
            </div>
            <Input.TextArea
              value={deleteReason}
              onChange={e => setDeleteReason(e.target.value)}
              rows={3}
              maxLength={200}
              showCount
              placeholder="請說明刪除此銷案案件的原因（必填，將寫入封存紀錄）"
            />
          </>
        )}
      </Modal>
    </div>
  )
}
