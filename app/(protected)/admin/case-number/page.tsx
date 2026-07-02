'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card, Row, Col, Typography, Tag, Space, Input, Button, Table, Modal, Alert, message, Descriptions, Tabs,
} from 'antd'
import { SearchOutlined, EditOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { api } from '@/lib/api'

const { Title, Text } = Typography

const STATUS_COLOR: Record<string, string> = {
  未決: 'blue', 已決: 'green', 銷案: 'default',
}

interface CaseItem {
  id: number
  caseNumber: string
  insuredName: string
  status: string
  commissionDate: string
  departmentName: string
}

interface FixResult {
  id: number
  insuredName: string
  oldCaseNumber: string
  newCaseNumber: string
  mailLogUpdated: number
  recomputed: { seqKey: string; nextSeq: number }[]
}

interface SeqRow {
  seqKey: string
  nextSeq: number | null
  usedTo: number | null
  actualMax: number
  status: 'in_sync' | 'behind' | 'ahead' | 'no_seed'
}

const SEQ_STATUS: Record<SeqRow['status'], { color: string; label: string }> = {
  in_sync: { color: 'green', label: '一致' },
  behind: { color: 'orange', label: '計數器落後（下次建案自癒）' },
  ahead: { color: 'gold', label: '計數器超前（曾跳號／刪案）' },
  no_seed: { color: 'default', label: '無計數器（下次建案將建立）' },
}

// ── 分頁 1：編號修正 ──────────────────────────────────────────────────────
function FixTab() {
  const [keyword, setKeyword] = useState('')
  const [rows, setRows] = useState<CaseItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const [editing, setEditing] = useState<CaseItem | null>(null)
  const [newNumber, setNewNumber] = useState('')
  const [saving, setSaving] = useState(false)

  const search = useCallback(async () => {
    const kw = keyword.trim()
    if (!kw) { message.warning('請先輸入公證編號或被保險人關鍵字'); return }
    setLoading(true)
    setSearched(true)
    const res = await api.get<CaseItem[]>(`/api/admin/case-number?keyword=${encodeURIComponent(kw)}`)
    if (res.success && res.data) setRows(res.data)
    else { setRows([]); message.error(res.error ?? '查詢失敗') }
    setLoading(false)
  }, [keyword])

  function openEdit(row: CaseItem) {
    setEditing(row)
    setNewNumber(row.caseNumber)
  }

  async function handleSave() {
    if (!editing) return
    const next = newNumber.trim()
    if (!next) { message.warning('新公證編號不可為空'); return }
    if (next === editing.caseNumber) { message.warning('新公證編號與現有相同'); return }

    setSaving(true)
    const res = await api.patch<FixResult>('/api/admin/case-number', { id: editing.id, newCaseNumber: next })
    setSaving(false)

    if (!res.success || !res.data) {
      message.error(res.error ?? '修正失敗')
      return
    }

    const d = res.data
    const recomputedText = d.recomputed.length
      ? d.recomputed.map((r) => `${r.seqKey}→${r.nextSeq}`).join('、')
      : '無'
    Modal.success({
      title: '公證編號已修正',
      content: (
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <div>被保險人：{d.insuredName}</div>
          <div>舊編號：<Text delete>{d.oldCaseNumber}</Text></div>
          <div>新編號：<Text strong>{d.newCaseNumber}</Text></div>
          <div>連動更新發信紀錄：{d.mailLogUpdated} 筆</div>
          <div>重算流水號計數器：{recomputedText}</div>
        </div>
      ),
    })
    setEditing(null)
    setRows((prev) => prev.map((r) => (r.id === d.id ? { ...r, caseNumber: d.newCaseNumber } : r)))
  }

  const columns = [
    { title: '公證編號', dataIndex: 'caseNumber', key: 'caseNumber', width: 200,
      render: (v: string) => <Text strong>{v}</Text> },
    { title: '被保險人', dataIndex: 'insuredName', key: 'insuredName', width: 180 },
    { title: '部門', dataIndex: 'departmentName', key: 'departmentName', width: 120 },
    { title: '狀態', dataIndex: 'status', key: 'status', width: 80, align: 'center' as const,
      render: (v: string) => <Tag color={STATUS_COLOR[v] ?? 'default'}>{v}</Tag> },
    { title: '委託日', dataIndex: 'commissionDate', key: 'commissionDate', width: 120,
      render: (v: string) => dayjs(v).format('YYYY/MM/DD') },
    { title: '操作', key: 'action', width: 100, align: 'center' as const,
      render: (_: unknown, row: CaseItem) => (
        <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>修正</Button>
      ) },
  ]

  return (
    <>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="修正提醒"
        description={
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            公證編號屬案件核心識別碼。修正後系統會一併更新該案件的發信紀錄（MailLog）快照，並重算受影響的流水號計數器。
            但<b>已寄出的信件、已列印／交付的公證書等對外文件仍為舊號、無法回收</b>，請確認確有需要再修正。
          </div>
        }
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space.Compact style={{ width: '100%', maxWidth: 480 }}>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={search}
            placeholder="輸入公證編號或被保險人名稱"
            allowClear
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
          />
          <Button type="primary" onClick={search} loading={loading}>查詢</Button>
        </Space.Compact>
      </Card>

      <Card size="small">
        <Table
          dataSource={rows}
          columns={columns}
          rowKey="id"
          size="small"
          bordered
          loading={loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: searched ? '查無符合的案件' : '請輸入關鍵字查詢' }}
        />
      </Card>

      <Modal
        title="修正公證編號"
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={handleSave}
        confirmLoading={saving}
        okText="確認修正"
        cancelText="取消"
        destroyOnClose
      >
        {editing && (
          <>
            <Descriptions column={1} size="small" style={{ marginBottom: 12 }}>
              <Descriptions.Item label="被保險人">{editing.insuredName}</Descriptions.Item>
              <Descriptions.Item label="部門">{editing.departmentName}</Descriptions.Item>
              <Descriptions.Item label="現有公證編號"><Text strong>{editing.caseNumber}</Text></Descriptions.Item>
            </Descriptions>
            <Text>新公證編號</Text>
            <Input
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              onPressEnter={handleSave}
              placeholder="輸入新的公證編號"
              style={{ marginTop: 4 }}
            />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              儲存後會檢查是否與其他案件重複；並同步更新此案件的發信紀錄與流水號計數器。
            </Text>
          </>
        )}
      </Modal>
    </>
  )
}

// ── 分頁 2：流水序號一覽 ──────────────────────────────────────────────────
function SeqTab() {
  const [rows, setRows] = useState<SeqRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<SeqRow[]>('/api/admin/case-number/seqs')
    if (res.success && res.data) setRows(res.data)
    else message.error(res.error ?? '查詢失敗')
    setLoading(false)
  }, [])

  // 首次掛載時載入
  useEffect(() => { load() }, [load])

  const columns = [
    { title: (
        <div style={{ lineHeight: 1.3 }}>
          種子（seqKey）
          <div style={{ fontSize: 11, fontWeight: 400, color: '#8c8c8c' }}>[部門代號][區域代碼]-[年度]</div>
        </div>
      ), dataIndex: 'seqKey', key: 'seqKey', width: 180,
      render: (v: string) => <Text strong>{v}</Text> },
    { title: '下一序號', dataIndex: 'nextSeq', key: 'nextSeq', width: 90, align: 'center' as const,
      render: (v: number | null) => (v == null ? '—' : v) },
    { title: '已取用至', dataIndex: 'usedTo', key: 'usedTo', width: 90, align: 'center' as const,
      render: (v: number | null) => (v == null ? '—' : v) },
    { title: '實際最大序號', dataIndex: 'actualMax', key: 'actualMax', width: 110, align: 'center' as const },
    { title: '狀態', dataIndex: 'status', key: 'status', width: 220,
      render: (v: SeqRow['status']) => <Tag color={SEQ_STATUS[v].color}>{SEQ_STATUS[v].label}</Tag> },
  ]

  return (
    <>
      <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
        <Col>
          <Text type="secondary" style={{ fontSize: 13 }}>
            列出所有流水號計數器（種子）。種子組成為 <Text code>[部門代號][區域代碼]-[年度]</Text>（如 <Text code>NL-25</Text>；區域代碼為空時省略該段）。
            「下一序號」為計數器將取用的號；「已取用至」＝下一序號−1；「實際最大序號」為該群組現有案件的最大流水號，供核對兩者是否一致。
          </Text>
        </Col>
        <Col>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>重新整理</Button>
        </Col>
      </Row>
      <Card size="small">
        <Table
          dataSource={rows}
          columns={columns}
          rowKey="seqKey"
          size="small"
          bordered
          loading={loading}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: '目前無流水號計數器資料' }}
        />
      </Card>
    </>
  )
}

export default function CaseNumberFixPage() {
  return (
    <div style={{ padding: 24 }}>
      <Row align="middle" style={{ marginBottom: 16 }}>
        <Col><Title level={4} style={{ margin: 0 }}>公證編號修正</Title></Col>
      </Row>

      <Tabs
        defaultActiveKey="fix"
        items={[
          { key: 'fix', label: '編號修正', children: <FixTab /> },
          { key: 'seq', label: '流水序號一覽', children: <SeqTab /> },
        ]}
      />
    </div>
  )
}
