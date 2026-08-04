'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Table, Tabs, Card, Select, InputNumber, Button, Typography, Space, Tag, message, Row, Col, ConfigProvider,
} from 'antd'
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import dayjs from 'dayjs'

const { Title, Text } = Typography

const CURRENT_YEAR = dayjs().year()
const YEAR_OPTIONS = [CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR].map((y) => ({ value: y, label: `${y} 年` }))

// [2026/07/28] - Lisa - 可檢視全公司的角色（範圍跨部門，故提供部門篩選）
const COMPANY_WIDE_ROLES = ['vp', 'admin_staff', 'sysadmin']
// [2026/07/30] - Lisa - 唯讀角色：承辦人（僅本人）＋行政人員（全公司但不可設定）
const READ_ONLY_ROLES = ['handler', 'admin_staff']

// [2026/07/28] - Lisa - 新增部門／組別欄位（後端已依部門→組別→員工排序）
interface EmployeeOption {
  id: number
  name: string
  departmentName: string
  teamGroup: string | null
}

interface SettingRow {
  employeeId: number
  name: string
  departmentName: string
  teamGroup: string | null
  curTargetAmount: number | null
  curTargetCaseCount: number | null
  refTargetAmount: number | null
  refTargetCaseCount: number | null
  refActualFee: number
  refActualCaseCount: number
  inventoryFee: number
  inventoryCaseCount: number
}

interface HistoryRow {
  id: number
  employeeId: number
  employeeName: string
  departmentName: string
  teamGroup: string | null
  year: number
  targetAmount: number | null
  targetCaseCount: number | null
  actualFee: number
  actualCaseCount: number
  setByName: string
  setAt: string
}

const numFmt = {
  formatter: (v: number | string | undefined) =>
    v != null && v !== '' ? `$ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '',
  parser: (v: string | undefined) => (v ? v.replace(/\$\s?|(,*)/g, '') : '') as unknown as number,
}

function pctTag(actual: number, target: number | null | undefined) {
  if (!target) return null
  const pct = Math.round((actual / target) * 100)
  return (
    <Tag color={pct >= 100 ? 'green' : pct >= 70 ? 'orange' : 'red'} style={{ fontSize: 11, marginLeft: 4 }}>
      {pct}%
    </Tag>
  )
}

export default function PerformancePage() {
  const { session } = useAuth()
  const canFilterDept = COMPANY_WIDE_ROLES.includes(session?.role ?? '')
  // [2026/07/28] - Lisa - 承辦人唯讀：兩個頁籤皆僅顯示本人（後端 getSubordinates 只回本人），不可設定
  // [2026/07/30] - Lisa - 行政人員一併改唯讀：範圍維持全公司（含部門篩選），但不可設定目標
  const isReadOnly = READ_ONLY_ROLES.includes(session?.role ?? '')
  const isSelfOnly = session?.role === 'handler'

  const [settingYear, setSettingYear] = useState(CURRENT_YEAR)
  const [settingDept, setSettingDept] = useState<string | null>(null)
  const [rows, setRows] = useState<SettingRow[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [histLoading, setHistLoading] = useState(true)
  const [histYear, setHistYear] = useState<number | null>(null)
  const [histEmployee, setHistEmployee] = useState<number | null>(null)
  const [editFee, setEditFee] = useState<Record<number, number | null>>({})
  const [editCount, setEditCount] = useState<Record<number, number | null>>({})

  const fetchSetting = async (year: number) => {
    setLoading(true)
    const res = await api.get<{ employees: EmployeeOption[]; rows: SettingRow[] }>(
      `/api/performance?year=${year}`
    )
    if (res.success && res.data) {
      setEmployees(res.data.employees)
      setRows(res.data.rows)
    }
    setLoading(false)
  }

  const fetchHistory = async () => {
    setHistLoading(true)
    const res = await api.get<HistoryRow[]>('/api/performance?mode=history')
    if (res.success && res.data) setHistory(res.data)
    setHistLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchSetting(settingYear) }, [settingYear])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchHistory() }, [])

  const rowMap = useMemo(() => new Map(rows.map((r) => [r.employeeId, r])), [rows])

  // [2026/07/28] - Lisa - 部門篩選（僅 vp／行政人員／系統管理員）；選項依後端排序（部門代碼）去重
  const deptOptions = useMemo(
    () => [
      { value: null as unknown as string, label: '全部部門' },
      ...[...new Set(rows.map((r) => r.departmentName).filter(Boolean))].map((d) => ({ value: d, label: d })),
    ],
    [rows]
  )

  const settingRows = useMemo(
    () => (canFilterDept && settingDept ? rows.filter((r) => r.departmentName === settingDept) : rows),
    [rows, settingDept, canFilterDept]
  )

  const dirtyFee = useMemo(
    () =>
      Object.entries(editFee).filter(([k, v]) => {
        if (v == null) return false
        return v !== (rowMap.get(Number(k))?.curTargetAmount ?? null)
      }),
    [editFee, rowMap]
  )

  const dirtyCount = useMemo(
    () =>
      Object.entries(editCount).filter(([k, v]) => {
        if (v == null) return false
        return v !== (rowMap.get(Number(k))?.curTargetCaseCount ?? null)
      }),
    [editCount, rowMap]
  )

  const hasEdits = dirtyFee.length > 0 || dirtyCount.length > 0

  async function handleSaveAll() {
    if (!hasEdits) { message.warning('尚無異動資料'); return }
    const allIds = new Set([
      ...dirtyFee.map(([k]) => Number(k)),
      ...dirtyCount.map(([k]) => Number(k)),
    ])
    const items = [...allIds].map((employeeId) => {
      const row = rowMap.get(employeeId)
      return {
        employeeId,
        targetAmount: editFee[employeeId] ?? row?.curTargetAmount ?? null,
        targetCaseCount: editCount[employeeId] ?? row?.curTargetCaseCount ?? null,
      }
    })
    const res = await api.post('/api/performance', { year: settingYear, items })
    if (res.success) {
      message.success(`${settingYear} 年度目標已儲存（共 ${items.length} 筆）`)
      setEditFee({})
      setEditCount({})
      fetchSetting(settingYear)
      fetchHistory()
    } else {
      message.error(res.error ?? '儲存失敗')
    }
  }

  function handleReset() {
    setEditFee({})
    setEditCount({})
  }

  const refYear = settingYear - 1

  const settingColumns: ColumnsType<SettingRow> = [
    {
      title: '部門', dataIndex: 'departmentName', key: 'departmentName',
      width: 110, fixed: 'left',
      onHeaderCell: () => ({ style: { textAlign: 'center' } }),
      render: (v: string) => v || <Text type="secondary">—</Text>,
    },
    {
      title: '組別', dataIndex: 'teamGroup', key: 'teamGroup',
      width: 80, fixed: 'left',
      onHeaderCell: () => ({ style: { textAlign: 'center' } }),
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: '員工', dataIndex: 'name', key: 'name',
      width: 90, fixed: 'left',
      onHeaderCell: () => ({ style: { textAlign: 'center' } }),
    },
    {
      title: `${settingYear} 年（目標設定）`,
      onHeaderCell: () => ({ style: { textAlign: 'center', background: '#f6ffed' } }),
      children: [
        {
          // [2026/07/28] - Lisa - 唯讀角色（承辦人／[2026/07/30] 行政人員）不顯示輸入框，改為純文字
          title: '純公證費', key: 'curFeeTarget', width: 130, align: isReadOnly ? 'right' : undefined,
          onHeaderCell: () => ({ style: { textAlign: 'center', background: '#f6ffed' } }),
          render: (_, r) => isReadOnly ? (
            r.curTargetAmount != null
              ? `$${r.curTargetAmount.toLocaleString()}`
              : <Text type="secondary">未設定</Text>
          ) : (
            <InputNumber
              style={{ width: '100%' }}
              min={0} step={100000}
              value={editFee[r.employeeId] ?? r.curTargetAmount ?? null}
              placeholder="請輸入"
              {...numFmt}
              onChange={(v) => setEditFee((prev) => ({ ...prev, [r.employeeId]: v ?? null }))}
            />
          ),
        },
        {
          // [2026/08/04] - Lisa - FR-110 達成率以「主辦件數」為分子，目標欄同步標示以免誤設為含協辦的人次
          title: '結案件數(主辦)', key: 'curCaseTarget', width: 110, align: isReadOnly ? 'right' : undefined,
          onHeaderCell: () => ({ style: { textAlign: 'center', background: '#f6ffed' } }),
          render: (_, r) => isReadOnly ? (
            r.curTargetCaseCount != null
              ? r.curTargetCaseCount
              : <Text type="secondary">未設定</Text>
          ) : (
            <InputNumber
              style={{ width: '100%' }}
              min={0} step={1} precision={0}
              value={editCount[r.employeeId] ?? r.curTargetCaseCount ?? null}
              placeholder="請輸入"
              onChange={(v) => setEditCount((prev) => ({ ...prev, [r.employeeId]: v ?? null }))}
            />
          ),
        },
      ],
    },
    {
      title: `${refYear} 年（參考值）`,
      onHeaderCell: () => ({ style: { textAlign: 'center', background: '#f0f5ff' } }),
      children: [
        {
          title: '目標',
          onHeaderCell: () => ({ style: { textAlign: 'center', background: '#f0f5ff' } }),
          children: [
            {
              title: '純公證費', key: 'refFeeTarget', width: 105, align: 'right',
              onHeaderCell: () => ({ style: { textAlign: 'center', background: '#f0f5ff' } }),
              render: (_, r) =>
                r.refTargetAmount != null ? `$${r.refTargetAmount.toLocaleString()}` : <Text type="secondary">—</Text>,
            },
            {
              title: '結案件數(主辦)', key: 'refCaseTarget', width: 100, align: 'right',
              onHeaderCell: () => ({ style: { textAlign: 'center', background: '#f0f5ff' } }),
              render: (_, r) =>
                r.refTargetCaseCount != null ? r.refTargetCaseCount : <Text type="secondary">—</Text>,
            },
          ],
        },
        {
          title: '實績',
          onHeaderCell: () => ({ style: { textAlign: 'center', background: '#f0f5ff' } }),
          children: [
            {
              title: '純公證費/達成率', key: 'refActualFee', width: 120, align: 'right',
              onHeaderCell: () => ({ style: { textAlign: 'center', background: '#f0f5ff' } }),
              render: (_, r) => (
                <span>${r.refActualFee.toLocaleString()}{pctTag(r.refActualFee, r.refTargetAmount)}</span>
              ),
            },
            {
              // [2026/08/04] - Lisa - FR-110 件數只計主辦，欄名標示避免與「參與人次」混淆
              title: '結案數(主辦)/達成率', key: 'refActualCount', width: 118, align: 'right',
              onHeaderCell: () => ({ style: { textAlign: 'center', background: '#f0f5ff' } }),
              render: (_, r) => (
                <span>{r.refActualCaseCount}{pctTag(r.refActualCaseCount, r.refTargetCaseCount)}</span>
              ),
            },
          ],
        },
      ],
    },
    {
      title: '庫存',
      onHeaderCell: () => ({ style: { textAlign: 'center', background: '#fffbe6' } }),
      children: [
        {
          title: '預估公證費', key: 'inventoryFee', width: 105, align: 'right',
          onHeaderCell: () => ({ style: { textAlign: 'center', background: '#fffbe6' } }),
          render: (_, r) => `$${r.inventoryFee.toLocaleString()}`,
        },
        {
          // [2026/08/04] - Lisa - FR-110 庫存件數亦只計主辦
          title: '未決件數(主辦)', key: 'inventoryCount', width: 100, align: 'right',
          onHeaderCell: () => ({ style: { textAlign: 'center', background: '#fffbe6' } }),
          render: (_, r) => r.inventoryCaseCount,
        },
      ],
    },
  ]

  const histFiltered = useMemo(
    () =>
      history.filter((t) => {
        if (histYear && t.year !== histYear) return false
        if (histEmployee && t.employeeId !== histEmployee) return false
        return true
      }),
    [history, histYear, histEmployee]
  )

  const histColumns: ColumnsType<HistoryRow> = [
    {
      title: '部門', dataIndex: 'departmentName', key: 'departmentName', width: 110,
      render: (v: string) => v || <Text type="secondary">—</Text>,
    },
    {
      title: '組別', dataIndex: 'teamGroup', key: 'teamGroup', width: 80,
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    { title: '員工', dataIndex: 'employeeName', key: 'emp', width: 100 },
    { title: '年度', dataIndex: 'year', key: 'year', width: 80, render: (v: number) => `${v} 年` },
    {
      title: '公證費目標', dataIndex: 'targetAmount', key: 'targetAmount', width: 130, align: 'right',
      render: (v: number | null) => (v != null ? `$${v.toLocaleString()}` : '—'),
    },
    {
      title: '結案件數(主辦)目標', dataIndex: 'targetCaseCount', key: 'targetCaseCount', width: 130, align: 'right',
      render: (v: number | null) => (v != null ? v : '—'),
    },
    {
      title: '實際公證費/達成率', key: 'actual', width: 160, align: 'right',
      render: (_, r) => (
        <span>${r.actualFee.toLocaleString()}{r.targetAmount ? pctTag(r.actualFee, r.targetAmount) : null}</span>
      ),
    },
    {
      // [2026/08/04] - Lisa - FR-110 件數只計主辦
      title: '實際結案數(主辦)/達成率', key: 'actualCount', width: 150, align: 'right',
      render: (_, r) => (
        <span>{r.actualCaseCount}{r.targetCaseCount ? pctTag(r.actualCaseCount, r.targetCaseCount) : null}</span>
      ),
    },
    { title: '設定人', dataIndex: 'setByName', key: 'setBy', width: 90 },
    { title: '設定日期', dataIndex: 'setAt', key: 'setAt', width: 110, render: (v: string) => dayjs(v).format('YYYY/MM/DD') },
  ]

  return (
    <ConfigProvider theme={{ components: { Table: { colorBorderSecondary: '#b0b8c4' } } }}>
      <div style={{ padding: 24 }}>
        <Title level={4} style={{ marginBottom: 16 }}>純公證費業績設定</Title>
        <Tabs
          defaultActiveKey="setting"
          items={[
            {
              key: 'setting',
              label: '年度目標設定',
              children: (
                <>
                  <Card size="small" style={{ marginBottom: 12 }}>
                    <Row gutter={[8, 8]} align="middle" justify="space-between">
                      <Col>
                        <Space>
                          <Text>設定年度</Text>
                          <Select
                            value={settingYear}
                            onChange={(v) => { setSettingYear(v); setEditFee({}); setEditCount({}); setSettingDept(null) }}
                            options={YEAR_OPTIONS}
                            style={{ width: 110 }}
                          />
                          {/* [2026/07/28] - Lisa - 全公司範圍角色才顯示部門篩選 */}
                          {canFilterDept && (
                            <>
                              <Text>部門</Text>
                              <Select
                                value={settingDept}
                                onChange={setSettingDept}
                                options={deptOptions}
                                style={{ width: 160 }}
                              />
                              <Text type="secondary">共 {settingRows.length} 位員工</Text>
                            </>
                          )}
                          {/* [2026/07/28] - Lisa - 承辦人唯讀提示；[2026/07/30] 行政人員唯讀（全公司可看不可設） */}
                          {isReadOnly && (
                            <Tag color="default" style={{ marginLeft: 4 }}>
                              {isSelfOnly ? '唯讀：僅顯示本人業績目標' : '唯讀：僅可檢視，不可設定'}
                            </Tag>
                          )}
                        </Space>
                      </Col>
                      {/* [2026/07/28] - Lisa - 唯讀角色不顯示重置／儲存 */}
                      {!isReadOnly && (
                      <Col>
                        <Space>
                          <Button
                            icon={<ReloadOutlined />}
                            disabled={!hasEdits}
                            onClick={handleReset}
                          >
                            重置
                          </Button>
                          <Button
                            type="primary"
                            icon={<SaveOutlined />}
                            disabled={!hasEdits}
                            style={hasEdits ? { background: '#1B4F8C' } : undefined}
                            onClick={handleSaveAll}
                          >
                            儲存
                          </Button>
                        </Space>
                      </Col>
                      )}
                    </Row>
                  </Card>
                  <Table
                    dataSource={settingRows}
                    columns={settingColumns}
                    rowKey="employeeId"
                    size="small"
                    bordered
                    loading={loading}
                    scroll={{ x: 'max-content' }}
                    pagination={false}
                    locale={{ emptyText: isSelfOnly ? '主管尚未設定本年度業績目標' : isReadOnly ? '無業績目標資料' : '無可設定的員工' }}
                  />
                </>
              ),
            },
            {
              key: 'history',
              label: '歷史年度目標查詢',
              children: (
                <>
                  <Card size="small" style={{ marginBottom: 12 }}>
                    <Row gutter={[8, 8]} align="middle">
                      <Col>
                        <Select
                          value={histYear}
                          onChange={setHistYear}
                          options={[{ value: null as unknown as number, label: '全部年度' }, ...YEAR_OPTIONS]}
                          style={{ width: 120 }}
                        />
                      </Col>
                      <Col>
                        <Select
                          value={histEmployee}
                          onChange={setHistEmployee}
                          options={[
                            { value: null as unknown as number, label: '全部員工' },
                            // [2026/07/28] - Lisa - 全公司範圍下同名員工難分辨，標示部門／組別
                            ...employees.map((e) => ({
                              value: e.id,
                              label: `${e.name}（${e.departmentName}${e.teamGroup ? `／${e.teamGroup}` : ''}）`,
                            })),
                          ]}
                          style={{ width: 220 }}
                        />
                      </Col>
                      <Col>
                        <Button onClick={() => { setHistYear(null); setHistEmployee(null) }}>重置</Button>
                      </Col>
                    </Row>
                  </Card>
                  <Table
                    dataSource={histFiltered}
                    columns={histColumns}
                    rowKey="id"
                    size="small"
                    bordered
                    loading={histLoading}
                    pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 筆` }}
                    locale={{ emptyText: '無歷史目標資料' }}
                  />
                </>
              ),
            },
          ]}
        />
      </div>
    </ConfigProvider>
  )
}
