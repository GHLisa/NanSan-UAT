'use client'

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import {
  Card, Row, Col, Typography, Tag, Button, Space, Steps, Timeline, Descriptions,
  Modal, Form, Select, AutoComplete, Input, message, Tooltip, Divider, DatePicker, InputNumber,
  Table, Checkbox, Radio, Spin, Collapse,
} from 'antd'
import {
  EditOutlined, SendOutlined, StopOutlined, ArrowLeftOutlined,
  SaveOutlined, CloseOutlined, PlusOutlined, DeleteOutlined, CheckOutlined,
  ClockCircleOutlined, RollbackOutlined, CheckCircleOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons'
import { api } from '@/lib/api'
import { useAuth } from '@/components/layout/AuthProvider'
import {
  CASE_STAGES, DOCUMENT_TYPES, STAGE_DOC_TYPES, INTERIM_DOC_TYPES, getApprovalFlow,
} from '@/lib/approvalFlow'
import dayjs from 'dayjs'

const { Title, Text } = Typography

// ── 常數 ──────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = { 未決: 'blue', 已決: 'green', 銷案: 'default' }
const REVIEW_STATUS_COLOR: Record<string, string> = {
  待複核: 'orange', 已核准: 'green', 退回: 'red',
  待執行副總閱: 'purple', 待加簽審核: 'geekblue', 加簽退回: 'red',
}
const CONTACT_FORM_STATUSES = ['待傳', '已回傳', '無']
const PARKING_STATUSES = ['申訴中', '訴訟中', '待請求時效']
const TRAVEL_REQUIRED_DOCS = ['結案報告書', '公證費 DEBIT NOTE']
// 送審「隨附文件勾選」選項：DOCUMENT_TYPES 之外另加「保險理賠案預警檢查表」（僅供勾選隨附，非可送審之文件類型）
const ATTACH_DOC_OPTIONS = [...DOCUMENT_TYPES, '保險理賠案預警檢查表']

const numFmt = {
  formatter: (v?: string | number) =>
    v != null ? `$ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '',
  parser: (v?: string) => (v ? v.replace(/\$\s?|(,*)/g, '') : '') as unknown as number,
}

// FR-77 修改記錄欄位格式化用
const DATE_FIELDS = new Set(['出險日期', '委託日期', '回傳日期', '初步報告日期', '最終報告日期'])

// ── 型別 ──────────────────────────────────────────────────────────────
interface Assignment {
  id?: number; employeeId: number | null; employeeName?: string
  role: string; contributionRatio: number
}
interface CoInsurer {
  id?: number; _key?: number; companyId: number | null; companyName?: string | null
  policyNumber: string; ratio: number | null
}
interface ReviewItem {
  id: number; documentType: string; checkedDocuments: string[]
  submittedBy: number; submitterName: string; submittedAt: string; submissionNotes: string | null
  reviewerId: number; reviewerName: string; reviewStatus: string; reviewRemarks: string | null; reviewedAt: string | null
  requiresVP: boolean; approverId: number | null; approverName: string | null
  approvalStatus: string | null; approvalRemarks: string | null; approvedAt: string | null
  requiresMidApproval: boolean; midApproverId: number | null; midApproverName: string | null
  midApprovalStatus: string | null; midApprovalRemarks: string | null; midApprovedAt: string | null
  interimTypes: string[]; interimAmount: number | null; feeReversed: boolean
  recordStatus: string | null // [2026/06/18] - Lisa - 方案1/2 終結狀態（已重送/已放棄）
}
interface CaseDetail {
  id: number; caseNumber: string; status: string; currentStage: string
  departmentId: number; departmentName: string; departmentCode: string
  insuranceCompanyId: number; insuranceCompanyName: string; insuranceCompanyCode: string
  brokerCompanyId: number | null; brokerCompanyName: string | null
  insuranceContact: string | null; policyNumber: string; insuredName: string
  insuranceType: string; incidentCause: string; incidentLocation: string
  parkingStatus: string | null; incidentDate: string; commissionDate: string
  contactFormStatus: string | null; contactReturnDate: string | null
  preliminaryReportDate: string | null; finalReportDate: string | null; closeDate: string | null
  nasFolder: string | null; isSpecialCase: boolean; notes: string | null
  estimatedAmount: number | null; coverageLimit: number | null; deductible: number | null; adjustmentAmount: number | null
  salvageValue: number | null
  finalAmount: number | null; estimatedFee: number | null; actualFee: number | null
  travelOtherExpense: number | null
  assignmentNotes: string | null
  coInsurers: CoInsurer[]
  assignments: Assignment[]
  progress: { id: number; stage: string; progressDate: string; description: string | null; creatorName: string }[]
  caseNotes: { id: number; noteDate: string; content: string; creatorName: string }[]
  logs: { id: number; changedAt: string; fieldName: string; oldValue: string | null; newValue: string | null; employeeName: string; logType: string }[]
  reviews: ReviewItem[]
}
interface MetaData {
  insuranceCompanies: { id: number; code: string; name: string }[]
  brokerCompanies: { id: number; name: string }[]
  insuranceTypes: { id: number; name: string }[]
  incidentLocations: { id: number; name: string }[]
  incidentCauses: { id: number; name: string }[]
  employees: { id: number; name: string }[]
}

// SLA 燈號（FR：依委託日推算）
function calcSla(commissionDate: string, prelimDate: string | null, status: string) {
  if (status !== '未決') return { emoji: '🟢', text: '正常' }
  const days = dayjs().diff(dayjs(commissionDate), 'day')
  if (!prelimDate) {
    if (days > 30) return { emoji: '🔴', text: '紅燈預警' }
    if (days > 14) return { emoji: '🟡', text: '黃燈預警' }
  }
  if (days > 90) return { emoji: '🔴', text: '紅燈預警' }
  return { emoji: '🟢', text: '正常' }
}

export default function CaseDetailPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const { session } = useAuth()
  const id = params.id as string
  const fromKey = searchParams.get('from')
  const fromReviews = fromKey === 'reviews'
  // [2026/06/18] - Lisa - 返回鍵回到來源模組（文件審核/案件查詢/儀表板/通知），預設回案件管理
  const FROM_PATHS: Record<string, string> = {
    reviews: '/reviews', settlements: '/settlements', dashboard: '/dashboard', notifications: '/notifications',
  }
  const backPath = (fromKey && FROM_PATHS[fromKey]) || '/cases'

  const role = session?.role
  const userId = session ? parseInt(session.sub) : null

  const [caseData, setCaseData] = useState<CaseDetail | null>(null)
  const [meta, setMeta] = useState<MetaData | null>(null)
  const [loading, setLoading] = useState(true)

  const loadCase = useCallback(async () => {
    const res = await api.get<CaseDetail>(`/api/cases/${id}`)
    if (res.success && res.data) setCaseData(res.data)
    setLoading(false)
  }, [id])

  useEffect(() => { loadCase() }, [loadCase])
  useEffect(() => {
    api.get<MetaData>('/api/meta').then((res) => { if (res.success && res.data) setMeta(res.data) })
  }, [])

  // ── Modal / 編輯狀態 ─────────────────────────────────────────────────
  const [reviewModalOpen, setReviewModalOpen] = useState(false)
  const [selectedDocType, setSelectedDocType] = useState<string | null>(null)
  const [reviewForm] = Form.useForm()

  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelForm] = Form.useForm()

  // [2026/06/18] - Lisa - 結案登錄（FR-23）
  const [closeModalOpen, setCloseModalOpen] = useState(false)
  const [closeForm] = Form.useForm()
  const [closing, setClosing] = useState(false)

  // 結案日期溯及修正
  const [fixDateOpen, setFixDateOpen] = useState(false)
  const [fixDateValue, setFixDateValue] = useState<dayjs.Dayjs | null>(null)
  const [fixingDate, setFixingDate] = useState(false)

  // 已決案件金額資訊修正
  const [fixAmtOpen, setFixAmtOpen] = useState(false)
  const [fixingAmt, setFixingAmt] = useState(false)
  const [fixAmtForm] = Form.useForm()

  const [reviewerRejectOpen, setReviewerRejectOpen] = useState(false)
  const [reviewerRejectForm] = Form.useForm()

  const [isEditing, setIsEditing] = useState(false)
  const [editForm] = Form.useForm()
  const [editAssignments, setEditAssignments] = useState<Assignment[]>([])
  const [editCoInsurers, setEditCoInsurers] = useState<CoInsurer[]>([])
  const [liveEstAmt, setLiveEstAmt] = useState<number | null>(null)
  const [liveAdjAmt, setLiveAdjAmt] = useState<number | null>(null)
  const [liveSalvageVal, setLiveSalvageVal] = useState<number | null>(null)
  const [liveInsType, setLiveInsType] = useState<string | null>(null)
  const [liveIcId, setLiveIcId] = useState<number | null>(null)
  const [editEstFee, setEditEstFee] = useState<FeeCalc | null>(null)
  const [editFinalFee, setEditFinalFee] = useState<FeeCalc | null>(null)
  const calcUserInteracted = useRef(false)
  const [saving, setSaving] = useState(false)

  const [noteAddOpen, setNoteAddOpen] = useState(false)
  const [noteForm] = Form.useForm()

  interface FeeCalc { fee: number; bands: { range?: string; rate?: number; fee?: number }[]; minApplied?: boolean }

  // ── 公證費試算（FR-18）──────────────────────────────────────────────
  const fetchFeeCalc = useCallback(async (amount: number | null): Promise<FeeCalc | null> => {
    if (!caseData || !amount || amount <= 0) return null
    const res = await api.post<Record<string, unknown>>('/api/fee-calc', {
      amount,
      estimatedAmount: amount,
      insuranceCompanyId: liveIcId ?? caseData.insuranceCompanyId,
      companyCode: caseData.insuranceCompanyCode,
      insuranceType: liveInsType ?? caseData.insuranceType,
      insuranceTypeId: meta?.insuranceTypes.find((t) => t.name === (liveInsType ?? caseData.insuranceType))?.id,
      commissionDate: caseData.commissionDate,
    })
    if (!res.success || !res.data) return null
    const d = res.data
    return {
      fee: (d.fee ?? d.baseFee ?? 0) as number,
      bands: (d.bands ?? []) as { range?: string; rate?: number; fee?: number }[],
      minApplied: (d.minApplied ?? false) as boolean,
    }
  }, [caseData, liveIcId, liveInsType, meta])

  useEffect(() => {
    if (!isEditing) return
    fetchFeeCalc(liveEstAmt).then((f) => {
      setEditEstFee(f)
      if (f && calcUserInteracted.current) editForm.setFieldValue('estimatedFee', f.fee)
    })
  }, [isEditing, liveEstAmt, liveInsType, liveIcId, fetchFeeCalc, editForm])

  useEffect(() => {
    if (!isEditing) return
    fetchFeeCalc(liveAdjAmt).then((f) => {
      setEditFinalFee(f)
      if (f && calcUserInteracted.current) editForm.setFieldValue('actualFee', f.fee)
    })
  }, [isEditing, liveAdjAmt, liveInsType, liveIcId, fetchFeeCalc, editForm])

  // ── 衍生資料 ─────────────────────────────────────────────────────────
  const reviews = caseData?.reviews ?? []
  const assignments = caseData?.assignments ?? []

  const isAssignee = useMemo(() => {
    if (!caseData || userId == null) return false
    return caseData.assignments.some((a) => a.employeeId === userId)
  }, [caseData, userId])

  // [2026/06/18] - Lisa - 每個文件類型最新一次送審時間：被退回但同文件已再次送審者，不再顯示放棄鈕
  const latestSubmittedByDoc = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of reviews) {
      const cur = m.get(r.documentType)
      if (!cur || r.submittedAt > cur) m.set(r.documentType, r.submittedAt)
    }
    return m
  }, [reviews])

  const isClosed = caseData ? caseData.status !== '未決' : false

  // 是否可操作（FR-35/58）：承辦人或本部門主管/管理員，且未決
  const canOperate = useMemo(() => {
    if (!caseData || isClosed) return false
    if (isAssignee) return true
    if (role === 'dept_manager' && session?.departmentId === caseData.departmentId) return true
    if (role === 'sysadmin') return true
    // [2026/06/18] - Lisa - 行政人員代為（非審核）：有部門限本部門、無部門全公司
    if (role === 'admin_staff' && (session?.departmentId == null || session.departmentId === caseData.departmentId)) return true
    return false
  }, [caseData, isClosed, isAssignee, role, session])

  // 結案日期溯及修正權限：sysadmin／本部門主管／行政人員（有部門限本部門、無部門全公司），且案件為已決
  const canFixCloseDate = useMemo(() => {
    if (!caseData || caseData.status !== '已決') return false
    if (role === 'sysadmin') return true
    if (role === 'dept_manager' && session?.departmentId === caseData.departmentId) return true
    if (role === 'admin_staff' && (session?.departmentId == null || session.departmentId === caseData.departmentId)) return true
    return false
  }, [caseData, role, session])

  // 已決案件金額資訊修正權限：sysadmin／本部門主管／行政人員（有部門限本部門、無部門全公司），且案件為已決
  const canFixAmounts = useMemo(() => {
    if (!caseData || caseData.status !== '已決') return false
    if (role === 'sysadmin') return true
    if (role === 'dept_manager' && session?.departmentId === caseData.departmentId) return true
    if (role === 'admin_staff' && (session?.departmentId == null || session.departmentId === caseData.departmentId)) return true
    return false
  }, [caseData, role, session])

  function getDocTypes(r: ReviewItem) {
    return r.documentType ? [r.documentType] : []
  }
  function isPending(r: ReviewItem) {
    return r.reviewStatus === '待複核' || r.midApprovalStatus === '待加簽審核' || r.approvalStatus === '待執行副總閱'
  }

  const hasPendingReviews = reviews.some(isPending)
  const pendingDocTypes = [...new Set(reviews.filter(isPending).flatMap(getDocTypes))]

  // FR-86 實際公證費變色狀態（Issue #8：追加公證費計入實際公證費）
  const feeAdditionStatus = useMemo<'pending' | 'approved' | null>(() => {
    const active = reviews.filter(
      (r) => r.interimTypes?.includes('追加預估公證費') && (r.interimAmount ?? 0) > 0 && !r.feeReversed,
    )
    if (active.length === 0) return null
    const approved = active.some(
      (r) => r.approvalStatus === '已核准' || (r.reviewStatus === '已核准' && !r.requiresVP),
    )
    return approved ? 'approved' : 'pending'
  }, [reviews])

  const interimReviews = reviews.filter((r) => (r.interimTypes?.length ?? 0) > 0 && !r.feeReversed)

  // [2026/06/18] - Lisa - 結案鈕條件（對齊 demo）：結案報告書已通過完整審核（主管核准 + 副總核准，或不需副總）
  const isCloseReportFullyApproved = useMemo(() =>
    reviews.some((r) =>
      r.documentType === '結案報告書' &&
      r.recordStatus == null &&
      r.reviewStatus === '已核准' &&
      (r.approvalStatus === '已核准' || !r.requiresVP),
    ), [reviews])

  // 結案分潤即時計算用：監看純公證費輸入
  const closeBaseFee = Form.useWatch('baseFee', closeForm)

  // FR-50/64：from=reviews 時主管/副總可操作的記錄
  const actionableReview = useMemo(() => {
    if (!fromReviews || userId == null) return null
    // 與後端 /api/reviews/[id] 權限一致：
    //   待複核 → 僅部門主管；待加簽審核 → 僅指定之審核者本人；待執行副總閱 → 僅執行副總
    return reviews.find((r) => {
      if (r.reviewStatus === '待複核' && role === 'dept_manager') return true
      if (r.midApprovalStatus === '待加簽審核' && r.midApproverId === userId) return true
      if (r.approvalStatus === '待執行副總閱' && role === 'vp') return true
      return false
    }) ?? null
  }, [fromReviews, reviews, role, userId])

  function isDuplicatePending(docType: string) {
    return reviews.some((r) => getDocTypes(r).includes(docType) && isPending(r))
  }

  function dispatchUpdated() {
    window.dispatchEvent(new Event('nansan:case-updated'))
  }

  // ── 編輯模式 ─────────────────────────────────────────────────────────
  function openEdit() {
    if (!caseData) return
    editForm.setFieldsValue({
      insuranceCompanyId: caseData.insuranceCompanyId,
      brokerCompanyId: caseData.brokerCompanyId,
      insuranceContact: caseData.insuranceContact,
      policyNumber: caseData.policyNumber,
      insuredName: caseData.insuredName,
      insuranceType: caseData.insuranceType,
      incidentCause: caseData.incidentCause,
      incidentLocation: caseData.incidentLocation,
      incidentDate: caseData.incidentDate ? dayjs(caseData.incidentDate) : null,
      commissionDate: caseData.commissionDate ? dayjs(caseData.commissionDate) : null,
      contactFormStatus: caseData.contactFormStatus,
      contactReturnDate: caseData.contactReturnDate ? dayjs(caseData.contactReturnDate) : null,
      parkingStatus: caseData.parkingStatus ?? null,
      nasFolder: caseData.nasFolder ?? '',
      deductible: caseData.deductible,
      estimatedAmount: caseData.estimatedAmount,
      coverageLimit: caseData.coverageLimit,
      estimatedFee: caseData.estimatedFee,
      adjustmentAmount: caseData.adjustmentAmount,
      salvageValue: caseData.salvageValue,
      finalAmount: caseData.finalAmount,
      actualFee: caseData.actualFee,
      travelOtherExpense: caseData.travelOtherExpense,
      isSpecialCase: caseData.isSpecialCase ?? false,
      notes: caseData.notes ?? '',
    })
    setEditAssignments(caseData.assignments.map((a) => ({ ...a })))
    setEditCoInsurers((caseData.coInsurers ?? []).map((c, i) => ({ ...c, _key: i })))
    calcUserInteracted.current = false
    setLiveEstAmt(caseData.estimatedAmount ?? null)
    setLiveAdjAmt(caseData.adjustmentAmount ?? null)
    setLiveSalvageVal(caseData.salvageValue ?? null)
    setLiveInsType(caseData.insuranceType ?? null)
    setLiveIcId(caseData.insuranceCompanyId ?? null)
    setEditEstFee(null)
    setEditFinalFee(null)
    setIsEditing(true)
  }

  function cancelEdit() {
    editForm.resetFields()
    setEditCoInsurers([])
    setEditEstFee(null)
    setEditFinalFee(null)
    setIsEditing(false)
  }

  async function handleEditSave(values: Record<string, unknown>) {
    // 共保資訊驗證
    for (let i = 0; i < editCoInsurers.length; i++) {
      const ci = editCoInsurers[i]
      if (!ci.policyNumber?.trim()) { message.error(`共保資訊第 ${i + 1} 筆：保單號碼必填`); return }
      if (!ci.ratio) { message.error(`共保資訊第 ${i + 1} 筆：共保比例必填`); return }
    }
    if (editCoInsurers.length > 0) {
      const coSum = editCoInsurers.reduce((s, c) => s + (c.ratio || 0), 0)
      if (coSum >= 100) { message.error('共保比例合計已達 100%，主保人須保留比例'); return }
    }
    // 承辦人驗證
    if (editAssignments.length === 0) { message.error('至少需要一位承辦人'); return }
    if (editAssignments.some((a) => !a.employeeId)) { message.error('請選擇承辦人'); return }
    const ratioSum = editAssignments.reduce((s, a) => s + (a.contributionRatio || 0), 0)
    if (Math.abs(ratioSum - 1.0) > 0.01) { message.error('承辦比例合計必須等於 100%'); return }
    // 承辦人須恰有一位主辦
    if (editAssignments.filter((a) => a.role === '主辦').length !== 1) { message.error('承辦人須恰有一位主辦'); return }

    setSaving(true)
    const payload: Record<string, unknown> = {
      insuranceCompanyId: values.insuranceCompanyId,
      brokerCompanyId: values.brokerCompanyId ?? null,
      insuranceContact: values.insuranceContact ?? null,
      policyNumber: values.policyNumber,
      insuredName: values.insuredName,
      insuranceType: values.insuranceType,
      incidentCause: values.incidentCause,
      incidentLocation: values.incidentLocation,
      parkingStatus: values.parkingStatus ?? null,
      incidentDate: (values.incidentDate as dayjs.Dayjs)?.toISOString() ?? caseData?.incidentDate,
      commissionDate: (values.commissionDate as dayjs.Dayjs)?.toISOString() ?? caseData?.commissionDate,
      contactFormStatus: values.contactFormStatus ?? null,
      contactReturnDate: (values.contactReturnDate as dayjs.Dayjs)?.toISOString() ?? null,
      nasFolder: values.nasFolder || null,
      deductible: values.deductible ?? null,
      estimatedAmount: values.estimatedAmount ?? null,
      coverageLimit: values.coverageLimit ?? null,
      estimatedFee: values.estimatedFee ?? null,
      adjustmentAmount: values.adjustmentAmount ?? null,
      salvageValue: values.salvageValue ?? null,
      finalAmount: values.finalAmount ?? null,
      actualFee: values.actualFee ?? null,
      travelOtherExpense: values.travelOtherExpense ?? null,
      isSpecialCase: values.isSpecialCase ?? false,
      notes: values.notes || null,
      assignees: editAssignments.map((a) => ({
        employeeId: a.employeeId,
        role: a.role,
        contributionRatio: a.contributionRatio,
      })),
      coInsurers: editCoInsurers.map((c) => ({
        companyId: c.companyId ?? null,
        policyNumber: c.policyNumber,
        ratio: c.ratio,
      })),
    }
    const res = await api.patch(`/api/cases/${id}`, payload)
    setSaving(false)
    if (res.success) {
      message.success('案件資料已更新')
      setIsEditing(false)
      dispatchUpdated()
      loadCase()
    } else {
      message.error(res.error ?? '更新失敗')
    }
  }

  // 承辦人列操作
  const addAssignment = () =>
    setEditAssignments((prev) => [...prev, { employeeId: null, role: '主辦', contributionRatio: 1.0 }])
  const removeAssignment = (idx: number) => setEditAssignments((prev) => prev.filter((_, i) => i !== idx))
  const updateAssignment = (idx: number, field: keyof Assignment, val: unknown) =>
    setEditAssignments((prev) => prev.map((a, i) => {
      if (i === idx) return { ...a, [field]: val }
      // 主辦唯一：某列設為主辦時，其餘自動降為協辦
      if (field === 'role' && val === '主辦' && a.role === '主辦') return { ...a, role: '協辦' }
      return a
    }))

  // 共保操作
  const addCoInsurer = () =>
    setEditCoInsurers((prev) => [...prev, { _key: Date.now(), companyId: null, policyNumber: '', ratio: null }])
  const removeCoInsurer = (idx: number) => setEditCoInsurers((prev) => prev.filter((_, i) => i !== idx))
  const updateCoInsurer = (idx: number, field: keyof CoInsurer, val: unknown) =>
    setEditCoInsurers((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: val } : c)))

  // ── 案件紀錄 ─────────────────────────────────────────────────────────
  async function handleAddNote(values: { noteDate?: dayjs.Dayjs; content: string }) {
    const res = await api.post(`/api/cases/${id}/notes`, {
      noteDate: (values.noteDate ?? dayjs()).toISOString(),
      content: values.content,
    })
    if (res.success) {
      message.success('紀錄已新增')
      noteForm.resetFields()
      setNoteAddOpen(false)
      dispatchUpdated()
      loadCase()
    } else {
      message.error(res.error ?? '新增失敗')
    }
  }

  // ── 送審（FR-12/36/47/85/86）────────────────────────────────────────
  async function doSubmitReview(values: Record<string, unknown>) {
    if (!caseData) return
    const docType = values.documentType as string
    const isInterim = INTERIM_DOC_TYPES.includes(docType)
    const interimType = isInterim ? (values.interimType as string | undefined) : undefined
    const interimAmount = isInterim ? (values.interimAmount as number | undefined) : undefined

    const res = await api.post('/api/reviews', {
      caseId: caseData.id,
      documentType: docType,
      submissionNotes: (values.submissionNotes as string) ?? '',
      checkedDocuments: (values.checkedDocuments as string[]) ?? [],
      interimTypes: interimType ? [interimType] : [],
      interimAmount: interimAmount ?? null,
    })
    if (res.success) {
      message.success('送審成功！')
      setReviewModalOpen(false)
      reviewForm.resetFields()
      setSelectedDocType(null)
      dispatchUpdated()
      loadCase()
    } else {
      message.error(res.error ?? '送審失敗')
    }
  }

  // [2026/06/18] - Lisa - 方案1 放棄被退回的送審（文件層級終結，移出待辦/退件）- Start
  function handleAbandonReview(r: ReviewItem) {
    Modal.confirm({
      title: '放棄此送審',
      content: (
        <div>
          <p>確定放棄「<strong>{r.documentType}</strong>」這筆被退回的送審？</p>
          <p style={{ color: '#888', fontSize: 12 }}>放棄後此筆將標記為「已放棄」並移出待辦/退件清單，不影響重新送件；紀錄保留供稽核，無法復原。</p>
        </div>
      ),
      okText: '確定放棄',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const res = await api.patch(`/api/reviews/${r.id}`, { action: 'abandon' })
        if (res.success) {
          message.success('已放棄此送審')
          dispatchUpdated()
          loadCase()
        } else {
          message.error(res.error ?? '放棄失敗')
        }
      },
    })
  }
  // [2026/06/18] - Lisa - 方案1 放棄被退回的送審 - end

  function handleSendReview(values: Record<string, unknown>) {
    if (!caseData) return
    const docType = values.documentType as string

    if (isDuplicatePending(docType)) {
      message.warning('此文件已有審核中記錄，請勿重複送審')
      return
    }
    if (TRAVEL_REQUIRED_DOCS.includes(docType) && caseData.travelOtherExpense == null) {
      message.error('送審前須至金額資訊填寫差旅其他費（無出差請填 0）')
      return
    }
    // [2026/06/18] - Lisa - Issue #2 理算書面報告書送審前須填理算損失額 - Start
    if (docType === '理算書面報告書' && caseData.adjustmentAmount == null) {
      message.error('送審「理算書面報告書」前，請先於金額資訊填寫「理算損失額」')
      return
    }
    // [2026/06/18] - Lisa - Issue #2 理算書面報告書送審前須填理算損失額 - end
    // [2026/07/14] - Lisa - 送審節點3「理算表」（理算明細表）前，理算相關金額欄位必填（可為 0，不得為空值）- Start
    // 理算損失淨額＝理算損失額－殘餘物價值（系統自動計算），故兩來源欄位皆填即不為空
    if (docType === '理算明細表') {
      const missing: string[] = []
      if (caseData.adjustmentAmount == null) missing.push('理算損失額')
      if (caseData.salvageValue == null) missing.push('殘餘物價值')
      if (caseData.finalAmount == null) missing.push('最終金額')
      if (missing.length > 0) {
        message.error(`送審「理算明細表」前，請先於金額資訊填寫：${missing.join('、')}（可為 0，不得為空值；理算損失淨額由系統自動計算）`)
        return
      }
    }
    // [2026/07/14] - Lisa - 送審節點3「理算表」必填檢查 - end

    const isInterim = INTERIM_DOC_TYPES.includes(docType)
    const interimType = isInterim ? (values.interimType as string | undefined) : undefined
    const interimAmount = isInterim ? (values.interimAmount as number | undefined) : undefined
    const addFee = interimType === '追加預估公證費'

    if (addFee && !interimAmount) {
      message.error('選擇追加公證費時，金額為必填')
      return
    }

    // [2026/06/18] - Lisa - Issue #8 追加公證費計入實際公證費（顯示文字改為實際公證費）- Start
    // FR-86 追加確認
    if (addFee && interimAmount && interimAmount > 0) {
      Modal.confirm({
        title: '確認追加實際公證費',
        content: (
          <div>
            <p>此操作將在實際公證費上追加 <strong>${interimAmount.toLocaleString()}</strong>。</p>
            <p>追加後實際公證費：<strong>${((caseData.actualFee ?? 0) + interimAmount).toLocaleString()}</strong></p>
            <p style={{ color: '#888', fontSize: 12 }}>確認後將寫入修改記錄，此操作不可撤回。</p>
          </div>
        ),
        // [2026/06/18] - Lisa - Issue #8 - end
        okText: '確認追加',
        cancelText: '取消',
        onOk: () => doSubmitReview(values),
      })
    } else {
      doSubmitReview(values)
    }
  }

  function closeReviewModal() {
    setReviewModalOpen(false)
    reviewForm.resetFields()
    setSelectedDocType(null)
  }

  // ── 撤案（FR-11/48）──────────────────────────────────────────────────
  async function handleConfirmCancel(values: { cancelReason: string }) {
    const res = await api.patch(`/api/cases/${id}`, { action: 'cancel', cancelReason: values.cancelReason })
    if (res.success) {
      message.success('已撤案')
      cancelForm.resetFields()
      setCancelModalOpen(false)
      dispatchUpdated()
      loadCase()
    } else {
      message.error(res.error ?? '撤案失敗')
    }
  }

  // [2026/06/18] - Lisa - 結案登錄（FR-23）：填出報告日、純公證費、差旅其他費，依承辦比例分潤 - Start
  function openCloseModal() {
    if (!caseData) return
    closeForm.setFieldsValue({
      reportDate: dayjs(),
      // 純公證費預帶實際公證費（含中間報告追加，Issue #8），避免結案覆寫遺漏
      baseFee: caseData.actualFee ?? caseData.estimatedFee ?? 0,
      travelExpense: caseData.travelOtherExpense ?? 0,
      remarks: '',
    })
    setCloseModalOpen(true)
  }

  async function handleCloseCase(values: Record<string, unknown>) {
    if (!caseData) return
    setClosing(true)
    const baseFee = Number(values.baseFee) || 0
    const travelExpense = Number(values.travelExpense) || 0
    const totalFee = baseFee // 實際公證費＝純公證費；差旅其他費另計
    const splits = assignments.map((a) => ({
      employeeId: a.employeeId as number,
      assignmentId: a.id ?? null,
      ratio: a.contributionRatio,
      amount: Math.round(totalFee * (a.contributionRatio ?? 0)),
    }))
    const res = await api.post('/api/settlements', {
      caseId: caseData.id,
      reportDate: (values.reportDate as dayjs.Dayjs).format('YYYY-MM-DD'),
      baseFee,
      travelExpense,
      totalFee,
      remarks: (values.remarks as string) ?? '',
      splits,
    })
    setClosing(false)
    if (res.success) {
      message.success('案件已結案，狀態更新為「已決」')
      setCloseModalOpen(false)
      dispatchUpdated()
      loadCase()
    } else {
      message.error(res.error ?? '結案失敗')
    }
  }
  // [2026/06/18] - Lisa - 結案登錄（FR-23）- end

  // 結案日期溯及修正：開啟 modal（預帶現值）與送出
  function openFixDate() {
    if (!caseData) return
    setFixDateValue(caseData.closeDate ? dayjs(caseData.closeDate) : dayjs())
    setFixDateOpen(true)
  }
  async function handleFixCloseDate() {
    if (!caseData || !fixDateValue) { message.error('請選擇結案日期'); return }
    setFixingDate(true)
    const res = await api.patch(`/api/cases/${id}`, {
      action: 'fixCloseDate',
      closeDate: fixDateValue.format('YYYY-MM-DD'),
    })
    setFixingDate(false)
    if (res.success) {
      message.success('結案日期已更新')
      setFixDateOpen(false)
      dispatchUpdated()
      loadCase()
    } else {
      message.error(res.error ?? '更新失敗')
    }
  }

  // 已決案件金額資訊修正：開啟 modal（預帶現值）與送出
  function openFixAmounts() {
    if (!caseData) return
    fixAmtForm.setFieldsValue({
      estimatedAmount: caseData.estimatedAmount ?? null,
      deductible: caseData.deductible ?? null,
      coverageLimit: caseData.coverageLimit ?? null,
      estimatedFee: caseData.estimatedFee ?? null,
      adjustmentAmount: caseData.adjustmentAmount ?? null,
      salvageValue: caseData.salvageValue ?? null,
      finalAmount: caseData.finalAmount ?? null,
      actualFee: caseData.actualFee ?? null,
      travelOtherExpense: caseData.travelOtherExpense ?? null,
    })
    setFixAmtOpen(true)
  }
  async function handleFixAmounts() {
    if (!caseData) return
    const values = await fixAmtForm.validateFields()
    setFixingAmt(true)
    const res = await api.patch(`/api/cases/${id}`, {
      action: 'fixAmounts',
      ...values,
    })
    setFixingAmt(false)
    if (res.success) {
      message.success('金額資訊已更新')
      setFixAmtOpen(false)
      dispatchUpdated()
      loadCase()
    } else {
      message.error(res.error ?? '更新失敗')
    }
  }

  // ── 審核快捷（FR-64）通過 / 退回 ─────────────────────────────────────
  function reviewerAction(r: ReviewItem): 'approve' | 'mid_approve' | 'vp_approve' | null {
    if (role === 'vp' && r.approvalStatus === '待執行副總閱') return 'vp_approve'
    if (r.midApprovalStatus === '待加簽審核' && r.midApproverId === userId) return 'mid_approve'
    if (role === 'dept_manager' && r.reviewStatus === '待複核') return 'approve'
    return null
  }

  async function handleReviewerApprove() {
    if (!actionableReview) return
    const act = reviewerAction(actionableReview)
    if (!act) return
    const res = await api.patch(`/api/reviews/${actionableReview.id}`, { action: act })
    if (res.success) {
      message.success('已通過')
      dispatchUpdated()
      router.push('/reviews')
    } else {
      message.error(res.error ?? '操作失敗')
    }
  }

  async function handleReviewerReject(values: { rejectReason: string }) {
    if (!actionableReview) return
    const approveAct = reviewerAction(actionableReview)
    const rejectAct =
      approveAct === 'vp_approve' ? 'vp_reject' : approveAct === 'mid_approve' ? 'mid_reject' : 'reject'
    const res = await api.patch(`/api/reviews/${actionableReview.id}`, { action: rejectAct, remarks: values.rejectReason })
    if (res.success) {
      message.success('已退回')
      setReviewerRejectOpen(false)
      reviewerRejectForm.resetFields()
      dispatchUpdated()
      router.push('/reviews')
    } else {
      message.error(res.error ?? '操作失敗')
    }
  }

  // ── 修改記錄欄位顯示格式化（FR-77）──────────────────────────────────
  function formatLogValue(fieldName: string, value: string | null) {
    if (value == null || value === '') return '(空白)'
    if (fieldName === '特殊案件') return value === 'true' ? '是' : value === 'false' ? '否' : value
    if (DATE_FIELDS.has(fieldName)) {
      const d = dayjs(value)
      return d.isValid() ? d.format('YYYY/MM/DD') : value
    }
    const num = Number(value)
    if (!Number.isNaN(num) && /^-?\d+$/.test(value)) return num.toLocaleString()
    return value
  }

  // ── Loading / 不存在 ─────────────────────────────────────────────────
  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>
  }
  if (!caseData) {
    return (
      <div className="page-container" style={{ padding: 24 }}>
        <Title level={4}>案件不存在</Title>
        <Button onClick={() => router.push('/cases')}>返回列表</Button>
      </div>
    )
  }

  const sla = calcSla(caseData.commissionDate, caseData.preliminaryReportDate, caseData.status)
  const currentStageIndex = CASE_STAGES.indexOf(caseData.currentStage)
  const deptCode = caseData.departmentCode

  // ── 流程進度 Steps（FR-59）──────────────────────────────────────────
  const stageItems = CASE_STAGES.map((s, i) => {
    const isFinished = i < currentStageIndex
    const isCurrent = i === currentStageIndex
    // [2026/07/14] - Lisa - 節點9「結案」：案件已決即點亮，並於下方顯示結案日期
    const isFinalClosed = s === '結案' && caseData.status === '已決'
    const docTypes = STAGE_DOC_TYPES[s]
    const stageRevs = docTypes ? reviews.filter((r) => docTypes.includes(r.documentType)) : []
    const stageApproved = stageRevs.some(
      (r) => r.approvalStatus === '已核准' || (r.reviewStatus === '已核准' && !r.approverId && !r.requiresVP),
    )
    const stagePending = stageRevs.some(isPending)
    const stageRejected = !stageApproved && !stagePending && stageRevs.some((r) => r.reviewStatus === '退回' || r.approvalStatus === '退回' || r.midApprovalStatus === '退回')
    const rejectionRemark = stageRejected
      ? stageRevs.find((r) => r.reviewStatus === '退回')?.reviewRemarks
        ?? stageRevs.find((r) => r.approvalStatus === '退回')?.approvalRemarks
        ?? stageRevs.find((r) => r.midApprovalStatus === '退回')?.midApprovalRemarks
      : null

    let icon
    if (isFinalClosed) {
      icon = (
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#52c41a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CheckOutlined style={{ color: '#fff', fontSize: 11 }} />
        </div>
      )
    } else if (stagePending) {
      icon = (
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#fa8c16', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ClockCircleOutlined style={{ color: '#fff', fontSize: 11 }} />
        </div>
      )
    } else if (stageApproved) {
      icon = (
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#1B4F8C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CheckOutlined style={{ color: '#fff', fontSize: 11 }} />
        </div>
      )
    } else if (stageRejected) {
      icon = (
        <Tooltip title={rejectionRemark || '已退回，尚未重新申請'}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#ff4d4f', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default' }}>
            <RollbackOutlined style={{ color: '#fff', fontSize: 11 }} />
          </div>
        </Tooltip>
      )
    } else if (isFinished) {
      icon = (
        <div style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'rgba(0,0,0,0.25)' }}>
          {i + 1}
        </div>
      )
    }

    const stagePendingRevs = stageRevs.filter(isPending)
    let description
    if (isFinalClosed) {
      description = caseData.closeDate ? (
        <div style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>結案日期</Text>
          <div style={{ fontSize: 12, color: '#52c41a', fontWeight: 600 }}>{dayjs(caseData.closeDate).format('YYYY/MM/DD')}</div>
        </div>
      ) : undefined
    } else if (stagePendingRevs.length > 0) {
      description = (
        <div style={{ marginTop: 4, maxWidth: 120 }}>
          {stagePendingRevs.map((r) => (
            <div key={r.id} style={{ marginBottom: 4 }}>
              <Tag color="orange" style={{ fontSize: 10, marginBottom: 2, whiteSpace: 'normal' }}>{r.documentType}</Tag>
              {r.checkedDocuments?.filter((d) => d !== r.documentType).map((d) => (
                <Tag key={d} style={{ fontSize: 10, marginBottom: 2, whiteSpace: 'normal' }}>{d}</Tag>
              ))}
            </div>
          ))}
        </div>
      )
    }

    return {
      title: s,
      status: (isFinalClosed || isFinished ? 'finish' : isCurrent ? 'process' : 'wait') as 'finish' | 'process' | 'wait',
      icon,
      description,
    }
  })

  const cardHeaderStyle = { background: '#EBF4FC', borderLeft: '4px solid #1B4F8C' }

  return (
    <div className="page-container" style={{ padding: 24 }}>
      {/* ── 標題列（FR-49 sticky）── */}
      <div style={{ position: 'sticky', top: 64, zIndex: 10, background: '#fff', paddingBottom: 12, marginBottom: 4, borderBottom: '1px solid #f0f0f0' }}>
        <Space style={{ marginBottom: 8 }}>
          <a onClick={() => router.push('/cases')} style={{ color: '#1B4F8C' }}>案件管理</a>
          <Text type="secondary">/</Text>
          <Text>{caseData.caseNumber}</Text>
        </Space>

        <Row justify="space-between" align="middle">
          <Col>
            <Space align="center" size={12}>
              <Title level={4} style={{ margin: 0 }}>{caseData.caseNumber}</Title>
              <Tag color={STATUS_COLOR[caseData.status]}>{caseData.status}</Tag>
              {caseData.isSpecialCase && <Tag color="red" style={{ fontWeight: 600 }}>特殊案件</Tag>}
              <Tooltip title={sla.text}><span style={{ fontSize: 18 }}>{sla.emoji}</span></Tooltip>
            </Space>
          </Col>
          <Col>
            {isEditing ? (
              <Space>
                <Button icon={<CloseOutlined />} onClick={cancelEdit}>取消</Button>
                <Button icon={<SaveOutlined />} type="primary" loading={saving} style={{ background: '#1B4F8C' }} onClick={() => editForm.submit()}>儲存</Button>
              </Space>
            ) : (
              <Space>
                <Button icon={<ArrowLeftOutlined />} onClick={() => router.push(backPath)}>返回列表</Button>
                {canFixCloseDate && (
                  <Button icon={<EditOutlined />} onClick={openFixDate}>修正結案日期</Button>
                )}
                {canFixAmounts && (
                  <Button icon={<EditOutlined />} onClick={openFixAmounts}>修正金額資訊</Button>
                )}
                {fromReviews && actionableReview && (
                  <>
                    <Button type="primary" icon={<CheckOutlined />} style={{ background: '#52c41a', borderColor: '#52c41a' }} onClick={handleReviewerApprove}>通過</Button>
                    <Button type="primary" danger icon={<RollbackOutlined />} onClick={() => setReviewerRejectOpen(true)}>退回</Button>
                  </>
                )}
                {!fromReviews && canOperate && (
                  <>
                    {!hasPendingReviews && (
                      <Button icon={<StopOutlined />} danger onClick={() => setCancelModalOpen(true)}>撤案</Button>
                    )}
                    <Button icon={<SendOutlined />} style={{ background: '#1B4F8C', borderColor: '#1B4F8C', color: '#fff' }} onClick={() => setReviewModalOpen(true)}>送審</Button>
                    {/* [2026/06/18] - Lisa - 結案鈕：結案報告書通過完整審核、且無審核中文件時顯示（FR-23） */}
                    {!hasPendingReviews && isCloseReportFullyApproved && (
                      <Button icon={<CheckCircleOutlined />} style={{ background: '#52c41a', borderColor: '#52c41a', color: '#fff' }} onClick={openCloseModal}>結案</Button>
                    )}
                    {/* [2026/07/08] - Lisa - 全面開放編輯：審核中亦可編輯（改動皆留修改記錄，並於送審記錄標示「送審後已修改」提醒審核者）*/}
                    <Button icon={<EditOutlined />} onClick={openEdit}>編輯</Button>
                    {hasPendingReviews && (
                      <Tooltip title={`下列文件審核中，編輯後審核者將看到「送審後已修改」提醒：${pendingDocTypes.join('、')}`}>
                        <Tag color="orange" icon={<ClockCircleOutlined />} style={{ cursor: 'default', padding: '4px 8px' }}>審核中</Tag>
                      </Tooltip>
                    )}
                  </>
                )}
              </Space>
            )}
          </Col>
        </Row>
      </div>

      <Form form={editForm} layout="vertical" onFinish={handleEditSave} size="small">
        <Row gutter={16} style={{ marginBottom: 16 }}>
          {/* ── 左欄：基本資訊 ── */}
          <Col span={14}>
            <Card title="基本資訊" size="small" styles={{ header: cardHeaderStyle, body: { padding: isEditing ? '12px 16px' : undefined } }}>
              {isEditing ? (
                <Row gutter={[12, 0]}>
                  <Col span={12}>
                    <Form.Item name="insuranceCompanyId" label="保險公司" rules={[{ required: true, message: '必填' }]}>
                      <Select showSearch optionFilterProp="label" options={meta?.insuranceCompanies.map((i) => ({ value: i.id, label: i.name }))} onChange={(v) => { calcUserInteracted.current = true; setLiveIcId(v) }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="承辦部門"><Input value={caseData.departmentName} disabled /></Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="insuredName" label="被保險人" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="insuranceType" label="險種" rules={[{ required: true, message: '必填' }]}>
                      <Select options={meta?.insuranceTypes.map((t) => ({ value: t.name, label: t.name }))} onChange={(v) => { calcUserInteracted.current = true; setLiveInsType(v) }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="policyNumber" label="保單號碼" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="incidentCause" label="出險原因" rules={[{ required: true, message: '必填' }]}>
                      <AutoComplete placeholder="選擇或輸入出險原因" allowClear options={(meta?.incidentCauses ?? []).map((c) => ({ value: c.name }))} filterOption={(i, o) => String(o?.value ?? '').toLowerCase().includes(i.toLowerCase())} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="brokerCompanyId" label="保代/保經公司">
                      <Select allowClear placeholder="無" options={meta?.brokerCompanies.map((b) => ({ value: b.id, label: b.name }))} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="insuranceContact" label="保險公司承辦人" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="incidentDate" label="出險日期" rules={[{ required: true, message: '必填' }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="commissionDate" label="委託日期" rules={[{ required: true, message: '必填' }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="contactFormStatus" label="聯絡單狀態">
                      <Select allowClear options={CONTACT_FORM_STATUSES.map((s) => ({ value: s, label: s }))} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="contactReturnDate" label="回傳日期"><DatePicker style={{ width: '100%' }} /></Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="incidentLocation" label="出險地點" rules={[{ required: true, message: '必填' }]}>
                      <AutoComplete allowClear placeholder="選擇或輸入出險/查勘地點" options={meta?.incidentLocations.map((l) => ({ value: l.name }))} filterOption={(i, o) => String(o?.value ?? '').toLowerCase().includes(i.toLowerCase())} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="parkingStatus" label="停泊案件狀態">
                      <Select allowClear placeholder="無" options={PARKING_STATUSES.map((s) => ({ value: s, label: s }))} />
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <Form.Item
                      label={
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          共保資訊
                          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={addCoInsurer} style={{ background: '#2E86C1', borderColor: '#2E86C1', fontWeight: 500 }}>新增共保</Button>
                        </span>
                      }
                      style={{ marginBottom: 4 }}
                    >
                      {editCoInsurers.map((ci, idx) => (
                        <div key={ci._key} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                          <Select allowClear showSearch placeholder="共保公司（選填）" value={ci.companyId ?? null} onChange={(v) => updateCoInsurer(idx, 'companyId', v ?? null)} options={meta?.insuranceCompanies.map((i) => ({ value: i.id, label: i.name }))} optionFilterProp="label" style={{ flex: '1 1 150px' }} />
                          <Input placeholder="共保保單號碼（必填）" value={ci.policyNumber} onChange={(e) => updateCoInsurer(idx, 'policyNumber', e.target.value)} status={ci.policyNumber === '' ? 'error' : ''} style={{ flex: '1 1 150px' }} />
                          <InputNumber min={0.01} max={99.99} precision={2} step={5} addonAfter="%" placeholder="比例" value={ci.ratio} onChange={(v) => updateCoInsurer(idx, 'ratio', v ?? null)} status={!ci.ratio ? 'error' : ''} style={{ flex: '0 0 120px' }} />
                          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeCoInsurer(idx)} />
                        </div>
                      ))}
                      {editCoInsurers.length > 0 && (() => {
                        const coSum = editCoInsurers.reduce((s, c) => s + (c.ratio || 0), 0)
                        const valid = coSum < 100
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', background: valid ? '#f6ffed' : '#fff2f0', border: `1px solid ${valid ? '#b7eb8f' : '#ffccc7'}`, borderRadius: 4, fontSize: 12 }}>
                            <Text style={{ flex: 1, fontSize: 12 }}>主保人剩餘比例</Text>
                            <Text strong style={{ color: valid ? '#52c41a' : '#ff4d4f' }}>{(100 - coSum).toFixed(2).replace(/\.?0+$/, '')}%</Text>
                            {!valid && <Text type="danger" style={{ fontSize: 11 }}>共保比例合計已達 100%</Text>}
                          </div>
                        )
                      })()}
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <Form.Item name="nasFolder" label="NAS 路徑">
                      <Input.TextArea placeholder="\\NAS-TP\cases\..." autoSize={{ minRows: 1, maxRows: 3 }} style={{ fontFamily: 'monospace', fontSize: 12 }} />
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <Form.Item shouldUpdate noStyle>
                      {({ getFieldValue }) => (
                        <>
                          <Form.Item name="isSpecialCase" valuePropName="checked" style={{ marginBottom: 4 }}>
                            <Checkbox>
                              <Text strong style={{ fontSize: 13 }}>特殊案件</Text>
                              <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>（如：關注案件、存在極大爭議、複雜度較高或金額較高…）</Text>
                            </Checkbox>
                          </Form.Item>
                          {getFieldValue('isSpecialCase') && (
                            <div style={{ marginBottom: 8, padding: '4px 10px', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 4, fontSize: 12, color: '#d46b08' }}>
                              ⚠️ 已標記為特殊案件，不論文件類型與金額，所有送審文件均需部門主管審核後轉執行副總閱示
                            </div>
                          )}
                        </>
                      )}
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <Form.Item name="notes" label="備註" style={{ marginBottom: 0 }}><Input.TextArea rows={2} placeholder="備註說明..." /></Form.Item>
                  </Col>
                </Row>
              ) : (
                <Descriptions column={2} size="small" labelStyle={{ fontWeight: 500, color: '#666' }}>
                  <Descriptions.Item label="保險公司">{caseData.insuranceCompanyName}</Descriptions.Item>
                  <Descriptions.Item label="承辦部門">{caseData.departmentName}</Descriptions.Item>
                  <Descriptions.Item label="被保險人">{caseData.insuredName}</Descriptions.Item>
                  <Descriptions.Item label="險種">{caseData.insuranceType}</Descriptions.Item>
                  <Descriptions.Item label="保單號碼">{caseData.policyNumber}</Descriptions.Item>
                  <Descriptions.Item label="出險原因">{caseData.incidentCause}</Descriptions.Item>
                  <Descriptions.Item label="保代/保經">{caseData.brokerCompanyName ?? <Text type="secondary">無</Text>}</Descriptions.Item>
                  <Descriptions.Item label="保險公司承辦人">{caseData.insuranceContact || '—'}</Descriptions.Item>
                  <Descriptions.Item label="出險日期">{dayjs(caseData.incidentDate).format('YYYY/MM/DD')}</Descriptions.Item>
                  <Descriptions.Item label="委託日期">{dayjs(caseData.commissionDate).format('YYYY/MM/DD')}</Descriptions.Item>
                  <Descriptions.Item label="聯絡單狀態">
                    <Space size={6}>
                      <Tag color={caseData.contactFormStatus === '已回傳' ? 'green' : caseData.contactFormStatus === '待傳' ? 'orange' : 'default'}>{caseData.contactFormStatus || '—'}</Tag>
                      {caseData.contactReturnDate && <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(caseData.contactReturnDate).format('YYYY/MM/DD')}</Text>}
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="回傳日期">{caseData.contactReturnDate ? dayjs(caseData.contactReturnDate).format('YYYY/MM/DD') : '—'}</Descriptions.Item>
                  <Descriptions.Item label="出險地點">
                    <Space size={6}>
                      <span>{caseData.incidentLocation}</span>
                      {caseData.parkingStatus && (
                        <Tag color={caseData.parkingStatus === '訴訟中' ? 'red' : caseData.parkingStatus === '申訴中' ? 'orange' : 'blue'}>{caseData.parkingStatus}</Tag>
                      )}
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="停泊案件狀態">
                    {caseData.parkingStatus
                      ? <Tag color={caseData.parkingStatus === '訴訟中' ? 'red' : caseData.parkingStatus === '申訴中' ? 'orange' : 'blue'}>{caseData.parkingStatus}</Tag>
                      : '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="交辦事項" span={2}>
                    {caseData.assignmentNotes ? <Text type="warning">{caseData.assignmentNotes}</Text> : '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="共保資訊" span={2}>
                    {!caseData.coInsurers?.length ? '—' : (() => {
                      const coSum = caseData.coInsurers.reduce((s, c) => s + (c.ratio || 0), 0)
                      return (
                        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', border: '1px solid #d9d9d9' }}>
                          <thead>
                            <tr style={{ background: '#fafafa', fontWeight: 600, color: '#555' }}>
                              <td style={{ padding: '5px 10px', borderBottom: '1px solid #d9d9d9', borderRight: '1px solid #d9d9d9' }}>共保公司</td>
                              <td style={{ padding: '5px 10px', borderBottom: '1px solid #d9d9d9', borderRight: '1px solid #d9d9d9' }}>共保保單號碼</td>
                              <td style={{ padding: '5px 10px', borderBottom: '1px solid #d9d9d9', textAlign: 'right' }}>共保比例</td>
                            </tr>
                          </thead>
                          <tbody>
                            {caseData.coInsurers.map((ci, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                                <td style={{ padding: '5px 10px', borderRight: '1px solid #f0f0f0' }}>{ci.companyName ?? '—'}</td>
                                <td style={{ padding: '5px 10px', borderRight: '1px solid #f0f0f0' }}>{ci.policyNumber}</td>
                                <td style={{ padding: '5px 10px', textAlign: 'right' }}>{ci.ratio}%</td>
                              </tr>
                            ))}
                            <tr style={{ background: '#EBF4FC', borderTop: '1px solid #d9d9d9' }}>
                              <td colSpan={2} style={{ padding: '5px 10px', borderRight: '1px solid #d9d9d9', color: '#555', fontSize: 11 }}>主保人剩餘比例</td>
                              <td style={{ padding: '5px 10px', textAlign: 'right', color: '#1B4F8C', fontWeight: 700 }}>{(100 - coSum).toFixed(2).replace(/\.?0+$/, '')}%</td>
                            </tr>
                          </tbody>
                        </table>
                      )
                    })()}
                  </Descriptions.Item>
                  <Descriptions.Item label="NAS 路徑" span={2}>
                    {caseData.nasFolder
                      ? <code style={{ display: 'block', fontFamily: 'monospace', fontSize: 11, background: 'rgba(150,150,150,.1)', border: '1px solid rgba(100,100,100,.2)', borderRadius: 3, padding: '2px 6px', wordBreak: 'break-all' }}>{caseData.nasFolder}</code>
                      : '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="特殊案件" span={2}>
                    {caseData.isSpecialCase
                      ? <Space size={8}><Tag color="red" style={{ fontWeight: 600 }}>特殊案件</Tag><Text type="secondary" style={{ fontSize: 12 }}>不論文件類型與金額，所有送審文件均需部門主管審核後轉執行副總閱示</Text></Space>
                      : <Text type="secondary">否</Text>}
                  </Descriptions.Item>
                  <Descriptions.Item label="備註" span={2}>{caseData.notes ? <Text type="warning">{caseData.notes}</Text> : '—'}</Descriptions.Item>
                </Descriptions>
              )}
            </Card>

            {/* ── 案件紀錄（FR-37）── */}
            <Card
              title="案件紀錄" size="small" style={{ marginTop: 8 }}
              styles={{ header: cardHeaderStyle }}
              extra={canOperate && !noteAddOpen && (
                <Button size="small" type="primary" icon={<PlusOutlined />} style={{ background: '#1B4F8C' }} onClick={() => setNoteAddOpen(true)}>新增紀錄</Button>
              )}
            >
              {noteAddOpen && (
                <Card size="small" style={{ marginBottom: 12, background: '#f6f9ff', border: '1px solid #d0e4ff' }}>
                  <Form form={noteForm} component={false} layout="inline" onFinish={handleAddNote} size="small" initialValues={{ noteDate: dayjs() }}>
                    <Form.Item name="noteDate" label="日期" rules={[{ required: true, message: '必填' }]} style={{ marginBottom: 8 }}><DatePicker style={{ width: 140 }} /></Form.Item>
                    <Form.Item name="content" label="要事" rules={[{ required: true, message: '請輸入要事內容' }]} style={{ flex: 1, marginBottom: 8, minWidth: 260 }}><Input.TextArea rows={2} placeholder="請輸入處理要事..." style={{ resize: 'none' }} /></Form.Item>
                    <Form.Item style={{ marginBottom: 8, alignSelf: 'flex-end' }}>
                      <Space>
                        <Button onClick={() => { noteForm.resetFields(); setNoteAddOpen(false) }}>取消</Button>
                        <Button type="primary" onClick={() => noteForm.submit()} style={{ background: '#1B4F8C' }}>確認新增</Button>
                      </Space>
                    </Form.Item>
                  </Form>
                </Card>
              )}
              {caseData.caseNotes.length === 0 && !noteAddOpen ? (
                <Text type="secondary">尚無案件紀錄</Text>
              ) : (
                caseData.caseNotes.map((n) => (
                  <Row key={n.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }} gutter={16} wrap={false}>
                    <Col style={{ minWidth: 80 }}><Tag color="#1B4F8C" style={{ fontSize: 12 }}>{n.creatorName ?? '—'}</Tag></Col>
                    <Col style={{ minWidth: 90 }}><Text type="secondary" style={{ fontSize: 12 }}>{dayjs(n.noteDate).format('YYYY/MM/DD')}</Text></Col>
                    <Col flex="auto"><Text style={{ fontSize: 13 }}>{n.content}</Text></Col>
                  </Row>
                ))
              )}
            </Card>
          </Col>

          {/* ── 右欄：金額 ── */}
          <Col span={10}>
            <Card title="金額資訊" size="small" style={{ marginBottom: 8 }} styles={{ header: cardHeaderStyle, body: { padding: isEditing ? '12px 16px' : undefined } }}>
              {isEditing ? (
                <Row gutter={[12, 0]}>
                  <Col span={12}>
                    <Form.Item name="estimatedAmount" label="預估金額">
                      <InputNumber style={{ width: '100%' }} min={0} step={100000} {...numFmt} onChange={(v) => { calcUserInteracted.current = true; setLiveEstAmt(v as number ?? null) }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="deductible" label="自負額"><InputNumber style={{ width: '100%' }} min={0} step={10000} {...numFmt} /></Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="coverageLimit" label="保額(賠償限額)"><InputNumber style={{ width: '100%' }} min={0} step={100000} {...numFmt} /></Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="estimatedFee" label="預估公證費"><InputNumber style={{ width: '100%' }} min={0} step={10000} {...numFmt} /></Form.Item>
                  </Col>
                  {editEstFee && (
                    <Col span={24}>
                      <Card size="small" style={{ background: '#EBF4FC', border: '1px solid #2E86C1', marginBottom: 8 }}>
                        <Text strong style={{ color: '#1B4F8C', fontSize: 12 }}>試算預估公證費：${editEstFee.fee.toLocaleString()}</Text>
                        {editEstFee.minApplied && <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>（低於最低費用，以最低費率計）</Text>}
                        {editEstFee.bands.length > 0 && <Divider style={{ margin: '6px 0' }} />}
                        {editEstFee.bands.map((b, i) => (
                          <Text key={i} type="secondary" style={{ display: 'block', fontSize: 11 }}>{b.range ?? `第${i + 1}層`}{b.rate != null && ` × ${(b.rate * 100).toFixed(2)}%`}{b.fee != null && ` = $${Math.round(b.fee).toLocaleString()}`}</Text>
                        ))}
                      </Card>
                    </Col>
                  )}
                  <Col span={24}><Divider style={{ margin: '4px 0 12px' }} /></Col>
                  <Col span={12}>
                    <Form.Item name="adjustmentAmount" label="理算損失額">
                      <InputNumber style={{ width: '100%' }} min={0} step={100000} {...numFmt} onChange={(v) => { calcUserInteracted.current = true; setLiveAdjAmt(v as number ?? null) }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="salvageValue" label="殘餘物價值">
                      <InputNumber style={{ width: '100%' }} min={0} step={10000} {...numFmt} onChange={(v) => { calcUserInteracted.current = true; setLiveSalvageVal(v as number ?? null) }} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="理算損失淨額">
                      <InputNumber
                        style={{ width: '100%', background: '#f5f5f5' }}
                        value={(liveAdjAmt != null || liveSalvageVal != null) ? (liveAdjAmt ?? 0) - (liveSalvageVal ?? 0) : null}
                        readOnly
                        {...numFmt}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="finalAmount" label="最終金額"><InputNumber style={{ width: '100%' }} min={0} step={100000} {...numFmt} /></Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="actualFee" label="實際公證費"><InputNumber style={{ width: '100%' }} min={0} step={10000} {...numFmt} /></Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="travelOtherExpense" label="差旅其他費" style={{ marginBottom: 0 }}><InputNumber style={{ width: '100%' }} min={0} step={100} placeholder="無出差請填 0" {...numFmt} /></Form.Item>
                  </Col>
                  {editFinalFee && (
                    <Col span={24}>
                      <Card size="small" style={{ background: '#EBF4FC', border: '1px solid #2E86C1', marginTop: 8 }}>
                        <Text strong style={{ color: '#1B4F8C', fontSize: 12 }}>試算實際公證費：${editFinalFee.fee.toLocaleString()}</Text>
                        {editFinalFee.minApplied && <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>（低於最低費用，以最低費率計）</Text>}
                        {editFinalFee.bands.length > 0 && <Divider style={{ margin: '6px 0' }} />}
                        {editFinalFee.bands.map((b, i) => (
                          <Text key={i} type="secondary" style={{ display: 'block', fontSize: 11 }}>{b.range ?? `第${i + 1}層`}{b.rate != null && ` × ${(b.rate * 100).toFixed(2)}%`}{b.fee != null && ` = $${Math.round(b.fee).toLocaleString()}`}</Text>
                        ))}
                      </Card>
                    </Col>
                  )}
                </Row>
              ) : (() => {
                const fmt = (v: number | null) => (v != null ? `$${v.toLocaleString()}` : '—')
                const deduct = caseData.deductible ?? 0
                const estComp = caseData.estimatedAmount != null ? caseData.estimatedAmount - deduct : null
                const netLoss = (caseData.adjustmentAmount != null || caseData.salvageValue != null)
                  ? (caseData.adjustmentAmount ?? 0) - (caseData.salvageValue ?? 0)
                  : null
                const row = (label: string, value: number | null, style: React.CSSProperties = {}) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                    <span style={{ color: '#666', fontWeight: 500, fontSize: 13 }}>{label}</span>
                    <span style={style}>{fmt(value)}</span>
                  </div>
                )
                return (
                  <div style={{ fontSize: 13 }}>
                    {row('預估金額', caseData.estimatedAmount, { fontWeight: 700, fontSize: 15 })}
                    {row('自負額', caseData.deductible)}
                    {row('預估賠償額', estComp)}
                    {row('保額(賠償限額)', caseData.coverageLimit)}
                    <Divider style={{ margin: '8px 0' }} />
                    {row('理算損失額', caseData.adjustmentAmount, { fontWeight: 700, color: '#1B4F8C' })}
                    {row('殘餘物價值', caseData.salvageValue)}
                    {row('理算損失淨額', netLoss, { fontWeight: 700, color: '#1B4F8C' })}
                    {row('最終金額', caseData.finalAmount, { fontWeight: 700, color: '#52c41a' })}
                    <Divider style={{ margin: '8px 0' }} />
                    {/* [2026/06/18] - Lisa - Issue #8 追加公證費變色指示移至「實際公證費」 - Start */}
                    {row('預估公證費', caseData.estimatedFee, { fontWeight: 700 })}
                    {row('實際公證費', caseData.actualFee, { fontWeight: 700, color: feeAdditionStatus === 'approved' ? '#fa8c16' : feeAdditionStatus === 'pending' ? '#ff4d4f' : undefined })}
                    {/* [2026/06/18] - Lisa - Issue #8 - end */}
                    {row('差旅其他費', caseData.travelOtherExpense)}
                  </div>
                )
              })()}
            </Card>

            {/* ── 公證費追加與預付紀錄（FR-87）── */}
            <Card title="公證費追加與預付紀錄" size="small" style={{ marginTop: 8 }} styles={{ header: cardHeaderStyle }}>
              {interimReviews.length === 0 ? (
                <Text type="secondary">尚無追加或預付紀錄</Text>
              ) : (
                interimReviews.map((r) => (
                  <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <Row justify="space-between" align="middle">
                      <Space size={4} wrap>{getDocTypes(r).map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>)}</Space>
                      <Text type="secondary" style={{ fontSize: 11 }}>{dayjs(r.submittedAt).format('YYYY/MM/DD')}</Text>
                    </Row>
                    <div style={{ marginTop: 6 }}>
                      {/* [2026/06/18] - Lisa - Issue #8 內部值維持「追加預估公證費」，顯示改為「追加實際公證費」 */}
                      {(r.interimTypes ?? []).map((t) => <Tag key={t} color={t === '追加預估公證費' ? 'orange' : 'blue'} style={{ fontSize: 11 }}>{t === '追加預估公證費' ? '追加實際公證費' : t}</Tag>)}
                      {(r.interimAmount ?? 0) > 0 && <Text strong style={{ fontSize: 12, marginLeft: 4 }}>${r.interimAmount!.toLocaleString()}</Text>}
                    </div>
                  </div>
                ))
              )}
            </Card>

            {/* ── 承辦人（FR-33/46/65）── */}
            <Card
              title="承辦人" size="small" style={{ marginTop: 8 }}
              styles={{ header: cardHeaderStyle, body: { padding: isEditing ? '12px 16px' : 0 } }}
              extra={isEditing && <Button size="small" icon={<PlusOutlined />} onClick={addAssignment}>新增承辦人</Button>}
            >
              {isEditing ? (
                <div>
                  {editAssignments.length > 0 && (
                    <Row gutter={8} style={{ marginBottom: 4, padding: '0 4px 4px', borderBottom: '1px solid #f0f0f0' }}>
                      <Col flex="auto"><Text type="secondary" style={{ fontSize: 12 }}>承辦人</Text></Col>
                      <Col style={{ width: 72 }}><Text type="secondary" style={{ fontSize: 12 }}>角色</Text></Col>
                      <Col style={{ width: 88 }}><Text type="secondary" style={{ fontSize: 12 }}>承辦比例</Text></Col>
                      <Col style={{ width: 32 }} />
                    </Row>
                  )}
                  {editAssignments.map((a, idx) => (
                    <Row key={idx} gutter={8} align="middle" style={{ marginTop: 6 }}>
                      <Col flex="auto">
                        <Select size="small" style={{ width: '100%' }} placeholder="選擇員工" value={a.employeeId} onChange={(v) => updateAssignment(idx, 'employeeId', v)} options={meta?.employees.map((e) => ({ value: e.id, label: e.name }))} showSearch optionFilterProp="label" />
                      </Col>
                      <Col style={{ width: 72 }}>
                        <Select size="small" style={{ width: '100%' }} value={a.role} onChange={(v) => updateAssignment(idx, 'role', v)} options={[{ value: '主辦', label: '主辦' }, { value: '協辦', label: '協辦' }]} />
                      </Col>
                      <Col style={{ width: 88 }}>
                        <InputNumber size="small" style={{ width: '100%' }} min={1} max={100} value={Math.round(a.contributionRatio * 100)} onChange={(v) => updateAssignment(idx, 'contributionRatio', (v ?? 100) / 100)} addonAfter="%" />
                      </Col>
                      <Col style={{ width: 32 }}>
                        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeAssignment(idx)} />
                      </Col>
                    </Row>
                  ))}
                  {editAssignments.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>尚無承辦人</Text>}
                  {editAssignments.length > 0 && (() => {
                    const sum = editAssignments.reduce((s, a) => s + (a.contributionRatio || 0), 0) * 100
                    const valid = Math.abs(sum - 100) < 0.5
                    return (
                      <div style={{ marginTop: 8, fontSize: 12, color: valid ? '#52c41a' : '#ff4d4f' }}>
                        承辦比例合計：{sum.toFixed(0)}%{!valid && '（須等於 100% 才可儲存）'}
                      </div>
                    )
                  })()}
                </div>
              ) : (
                <Table
                  dataSource={assignments} rowKey={(r) => r.id ?? r.employeeId ?? Math.random()} size="small" pagination={false}
                  locale={{ emptyText: '尚未設定承辦人' }}
                  columns={[
                    { title: '承辦人', key: 'name', render: (_, a) => <Text strong>{a.employeeName ?? '—'}</Text> },
                    { title: '角色', key: 'role', width: 65, render: (_, a) => <Tag color={a.role === '主辦' ? '#1B4F8C' : 'default'} style={{ fontSize: 11 }}>{a.role}</Tag> },
                    { title: '承辦比例', key: 'ratio', width: 80, align: 'center' as const, render: (_, a) => `${(a.contributionRatio * 100).toFixed(0)}%` },
                  ]}
                />
              )}
            </Card>
          </Col>
        </Row>
      </Form>

      {/* ── 案件流程進度（FR-59）── */}
      <Card title="案件流程進度" size="small" style={{ marginBottom: 16 }} styles={{ header: cardHeaderStyle }}>
        <Steps items={stageItems} size="small" labelPlacement="vertical" style={{ padding: '8px 0' }} />
      </Card>

      {/* ── 進度記錄 + 送審記錄 ── */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={14}>
          <Card title="進度記錄" size="small" styles={{ header: cardHeaderStyle }}>
            {caseData.progress.length === 0 ? (
              <Text type="secondary">尚無記錄</Text>
            ) : (
              <Timeline
                items={caseData.progress.map((p) => ({
                  children: (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(p.progressDate).format('YYYY/MM/DD')}</Text>
                      <Text style={{ marginLeft: 8, fontWeight: 500, fontSize: 13 }}>{p.stage}</Text>
                      {p.description && <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>{p.description}</div>}
                    </div>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>
        <Col span={10}>
          {/* ── 送審記錄（FR-72）── */}
          <Card title="送審記錄" size="small" styles={{ header: cardHeaderStyle }}>
            {reviews.length === 0 ? (
              <Text type="secondary">尚無送審記錄</Text>
            ) : (
              reviews.map((r) => {
                const displayStatus = r.midApprovalStatus === '待加簽審核' ? '待加簽審核'
                  : r.midApprovalStatus === '退回' ? '加簽退回'
                  : r.approvalStatus ?? r.reviewStatus
                // [2026/06/18] - Lisa - 方案1/2 終結狀態與放棄按鈕
                const isRejected = r.reviewStatus === '退回' || r.midApprovalStatus === '退回' || r.approvalStatus === '退回'
                // 同文件已再次送審（存在更新一筆）者，視為已被取代，不再顯示放棄鈕（涵蓋未 backfill 的舊資料）
                const isLatestForDoc = r.submittedAt === latestSubmittedByDoc.get(r.documentType)
                const canAbandon = isRejected && r.recordStatus == null && isAssignee && isLatestForDoc
                // [2026/07/08] - Lisa - 全面開放編輯配套：送審後案件欄位若被修改，於此筆審核中記錄標示，提醒審核者審核基準已變動
                // [2026/07/09] - Lisa - 比較基準改為「當前關卡起始時間」，避免主管關卡的修改一路帶到副總關卡：
                //   待複核→送件時 submittedAt；待加簽審核→主管複核完成 reviewedAt；待執行副總閱→前一關完成 midApprovedAt/reviewedAt
                const stageStart = r.approvalStatus === '待執行副總閱'
                  ? (r.midApprovedAt ?? r.reviewedAt ?? r.submittedAt)
                  : r.midApprovalStatus === '待加簽審核'
                    ? (r.reviewedAt ?? r.submittedAt)
                    : r.submittedAt
                const editedFieldsAfterSubmit = isPending(r)
                  ? [...new Set(
                      caseData.logs
                        .filter((l) => l.logType === 'edit' && dayjs(l.changedAt).isAfter(dayjs(stageStart)))
                        .map((l) => l.fieldName),
                    )]
                  : []
                return (
                  <Card key={r.id} size="small" style={{ marginBottom: 8, background: r.recordStatus ? '#f5f5f5' : '#fafafa', opacity: r.recordStatus ? 0.7 : 1 }}>
                    <Row justify="space-between" align="middle">
                      <Space size={4} wrap>{getDocTypes(r).map((t) => <Tag key={t} style={{ fontSize: 12, margin: 0 }}>{t}</Tag>)}</Space>
                      <Space size={4}>
                        {editedFieldsAfterSubmit.length > 0 && (
                          <Tooltip title={`本關卡送出後已修改欄位：${editedFieldsAfterSubmit.join('、')}。核准前請確認審核基準是否仍正確。`}>
                            <Tag color="volcano" icon={<ExclamationCircleOutlined />} style={{ fontSize: 11 }}>送審後已修改</Tag>
                          </Tooltip>
                        )}
                        {r.recordStatus && <Tag color="default" style={{ fontSize: 11 }}>{r.recordStatus}</Tag>}
                        <Tag color={REVIEW_STATUS_COLOR[displayStatus] ?? 'default'}>{displayStatus}</Tag>
                        {canAbandon && <Button size="small" danger onClick={() => handleAbandonReview(r)}>放棄</Button>}
                      </Space>
                    </Row>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(r.submittedAt).format('YYYY/MM/DD HH:mm')}
                      {r.submitterName && <span style={{ marginLeft: 6 }}>送件：{r.submitterName}</span>}
                    </Text>
                    {r.submissionNotes && <div style={{ marginTop: 4, fontSize: 12, color: '#555' }}>送審說明：{r.submissionNotes}</div>}
                    {r.reviewerName && (
                      <div style={{ marginTop: 4, fontSize: 12, color: '#555' }}>
                        複核：{r.reviewerName}
                        {r.reviewedAt && <span style={{ color: '#aaa', marginLeft: 4 }}>（{dayjs(r.reviewedAt).format('YYYY/MM/DD HH:mm')}）</span>}
                      </div>
                    )}
                    {r.reviewRemarks && <div style={{ fontSize: 12, color: r.reviewStatus === '退回' ? '#ff4d4f' : '#555' }}>意見：{r.reviewRemarks}</div>}
                    {r.requiresMidApproval && r.midApproverName && (
                      <>
                        <Divider dashed style={{ margin: '6px 0', borderColor: '#aaa' }} />
                        <div style={{ fontSize: 12, color: '#555' }}>
                          加簽審核：{r.midApproverName}
                          {r.midApprovalStatus && <span style={{ marginLeft: 4 }}>（{r.midApprovalStatus}）</span>}
                          {r.midApprovedAt && <span style={{ color: '#aaa', marginLeft: 4 }}>{dayjs(r.midApprovedAt).format('YYYY/MM/DD HH:mm')}</span>}
                        </div>
                        {r.midApprovalRemarks && <div style={{ fontSize: 12, color: r.midApprovalStatus === '退回' ? '#ff4d4f' : '#555' }}>意見：{r.midApprovalRemarks}</div>}
                      </>
                    )}
                    {r.requiresVP && r.approverName && (
                      <>
                        <Divider dashed style={{ margin: '6px 0', borderColor: '#aaa' }} />
                        <div style={{ fontSize: 12, color: '#555' }}>
                          執行副總：{r.approverName}
                          {r.approvalStatus && <span style={{ marginLeft: 4 }}>（{r.approvalStatus}）</span>}
                          {r.approvedAt && <span style={{ color: '#aaa', marginLeft: 4 }}>{dayjs(r.approvedAt).format('YYYY/MM/DD HH:mm')}</span>}
                        </div>
                        {r.approvalRemarks && <div style={{ fontSize: 12, color: r.approvalStatus === '退回' ? '#ff4d4f' : '#555' }}>意見：{r.approvalRemarks}</div>}
                      </>
                    )}
                  </Card>
                )
              })
            )}
          </Card>
        </Col>
      </Row>

      {/* ── 修改記錄（FR-77，預設折疊）── */}
      <Collapse
        style={{ marginBottom: 16 }}
        items={[{
          key: 'logs',
          label: '修改記錄（系統）',
          children: caseData.logs.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 13 }}>尚無修改記錄</Text>
          ) : (
            <Timeline
              style={{ marginTop: 8 }}
              // [2026/07/08] - Lisa - 同一批（同時間、同人員）的變更合併於一個時間/人員標籤下逐欄位列出
              items={(() => {
                const groups: { key: string; changedAt: string; employeeName: string; entries: typeof caseData.logs }[] = []
                for (const log of caseData.logs) {
                  const key = `${dayjs(log.changedAt).format('YYYY/MM/DD HH:mm')}|${log.employeeName}`
                  const last = groups[groups.length - 1]
                  if (last && last.key === key) last.entries.push(log)
                  else groups.push({ key, changedAt: log.changedAt, employeeName: log.employeeName, entries: [log] })
                }
                return groups.map((g) => ({
                  children: (
                    <div>
                      <Space size={8}>
                        <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(g.changedAt).format('YYYY/MM/DD HH:mm')}</Text>
                        <Tag color="#1B4F8C" style={{ fontSize: 11 }}>{g.employeeName}</Tag>
                      </Space>
                      {g.entries.map((log) => (
                        <div key={log.id} style={{ marginTop: 6, fontSize: 12, color: '#555' }}>
                          <Text strong style={{ fontSize: 12 }}>{log.fieldName}</Text>
                          {log.fieldName === '承辦人' ? (
                            <Text type="secondary" style={{ marginLeft: 6 }}>承辦人已變更</Text>
                          ) : (
                            <>
                              <Text delete style={{ color: '#aaa', margin: '0 4px' }}>{formatLogValue(log.fieldName, log.oldValue)}</Text>
                              <Text style={{ color: '#888' }}>→</Text>
                              <Text style={{ color: '#1B4F8C', marginLeft: 4 }}>{formatLogValue(log.fieldName, log.newValue)}</Text>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  ),
                }))
              })()}
            />
          ),
        }]}
      />

      {/* ── 撤案 Modal（FR-11/48）── */}
      <Modal
        title={<Space><StopOutlined style={{ color: '#ff4d4f' }} /><span>撤案確認</span></Space>}
        open={cancelModalOpen}
        onCancel={() => { cancelForm.resetFields(); setCancelModalOpen(false) }}
        footer={null} width={480}
      >
        {hasPendingReviews ? (
          <div style={{ padding: '8px 0' }}>
            <Card size="small" style={{ background: '#fff2f0', border: '1px solid #ffccc7', marginBottom: 16 }}>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Text strong style={{ color: '#cf1322' }}>目前有文件正在審核流程中，無法撤案</Text>
                <Text style={{ fontSize: 13, color: '#555' }}>審核中文件：{pendingDocTypes.map((d) => <Tag key={d} color="orange" style={{ marginLeft: 4 }}>{d}</Tag>)}</Text>
              </Space>
            </Card>
            <Row justify="end"><Button onClick={() => setCancelModalOpen(false)}>關閉</Button></Row>
          </div>
        ) : (
          <Form form={cancelForm} layout="vertical" onFinish={handleConfirmCancel} style={{ paddingTop: 8 }}>
            <Form.Item name="cancelReason" label="撤案原因" rules={[{ required: true, whitespace: true, message: '請輸入撤案原因' }]}>
              <Input.TextArea rows={4} placeholder="請說明撤案原因，例如：保險公司撤回委任、被保險人撤案…" showCount maxLength={200} />
            </Form.Item>
            <Row justify="end">
              <Space>
                <Button onClick={() => { cancelForm.resetFields(); setCancelModalOpen(false) }}>取消撤案</Button>
                <Button danger type="primary" htmlType="submit" icon={<StopOutlined />}>確定撤案</Button>
              </Space>
            </Row>
          </Form>
        )}
      </Modal>

      {/* ── 結案登錄 Modal（FR-23）── */}
      <Modal
        title={<Space><CheckCircleOutlined style={{ color: '#52c41a' }} /><span>結案登錄</span></Space>}
        open={closeModalOpen}
        onCancel={() => { closeForm.resetFields(); setCloseModalOpen(false) }}
        onOk={() => closeForm.submit()}
        okText="確定結案"
        cancelText="取消"
        okButtonProps={{ loading: closing, style: { background: '#52c41a', borderColor: '#52c41a' } }}
        width={520}
        destroyOnClose
      >
        <Form form={closeForm} layout="vertical" onFinish={handleCloseCase} style={{ marginTop: 8 }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="reportDate" label="結案日期" rules={[{ required: true, message: '請選擇結案日期' }]}>
                <DatePicker style={{ width: '100%' }} format="YYYY/MM/DD" inputReadOnly={false} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="baseFee" label="純公證費（未稅）" rules={[{ required: true, message: '請輸入純公證費' }]}>
                <InputNumber style={{ width: '100%' }} min={0} step={10000} {...numFmt} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="travelExpense" label="差旅其他費">
                <InputNumber style={{ width: '100%' }} min={0} step={1000} {...numFmt} />
              </Form.Item>
            </Col>
          </Row>

          {/* 承辦分潤（依承辦比例自動計算純公證費） */}
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>承辦分潤（依承辦比例分攤純公證費）</Text>
            <div style={{ marginTop: 4 }}>
              {assignments.map((a) => (
                <Row key={a.id ?? a.employeeId} justify="space-between" style={{ fontSize: 13, padding: '2px 0' }}>
                  <Col>
                    {a.employeeName ?? '—'}
                    <Tag style={{ marginLeft: 6, fontSize: 11 }}>{a.role}</Tag>
                    <Text type="secondary" style={{ fontSize: 12 }}>{Math.round((a.contributionRatio ?? 0) * 100)}%</Text>
                  </Col>
                  <Col style={{ fontWeight: 600, color: '#1B4F8C' }}>
                    ${Math.round((Number(closeBaseFee) || 0) * (a.contributionRatio ?? 0)).toLocaleString()}
                  </Col>
                </Row>
              ))}
            </div>
          </div>

          <Form.Item name="remarks" label="備註（選填）" style={{ marginBottom: 12 }}>
            <Input.TextArea rows={2} placeholder="補充說明..." />
          </Form.Item>

          <Card size="small" style={{ background: '#f6ffed', border: '1px solid #b7eb8f' }}>
            <Text style={{ fontSize: 12, color: '#389e0d' }}>
              結案後案件狀態改為「已決」，純公證費寫入實際公證費，且無法再編輯或送審文件。
            </Text>
          </Card>
        </Form>
      </Modal>

      {/* ── 結案日期溯及修正 Modal ── */}
      <Modal
        title={<Space><EditOutlined /><span>修正結案日期</span></Space>}
        open={fixDateOpen}
        onCancel={() => setFixDateOpen(false)}
        onOk={handleFixCloseDate}
        okText="確定修正"
        cancelText="取消"
        okButtonProps={{ loading: fixingDate, style: { background: '#1B4F8C' } }}
        width={420}
        destroyOnClose
      >
        <div style={{ marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            調整此已決案件的「結案日期」。此日期為年度統計、業績分攤的歸戶依據，修正將記入修改記錄。
          </Text>
          <div style={{ marginTop: 12 }}>
            <Text strong style={{ marginRight: 8 }}>結案日期</Text>
            <DatePicker value={fixDateValue} onChange={setFixDateValue} format="YYYY/MM/DD" allowClear={false} style={{ width: 200 }} />
          </div>
        </div>
      </Modal>

      {/* ── 已決案件金額資訊修正 Modal ── */}
      <Modal
        title={<Space><EditOutlined /><span>修正金額資訊</span></Space>}
        open={fixAmtOpen}
        onCancel={() => setFixAmtOpen(false)}
        onOk={handleFixAmounts}
        okText="確定修正"
        cancelText="取消"
        okButtonProps={{ loading: fixingAmt, style: { background: '#1B4F8C' } }}
        width={560}
        destroyOnClose
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          修正此已決案件的金額資訊。金額為年度統計、業績分攤的核算依據，修正將記入修改記錄。
        </Text>
        <Form form={fixAmtForm} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={[12, 0]}>
            <Col span={12}><Form.Item name="estimatedAmount" label="預估金額"><InputNumber style={{ width: '100%' }} min={0} step={100000} {...numFmt} /></Form.Item></Col>
            <Col span={12}><Form.Item name="deductible" label="自負額"><InputNumber style={{ width: '100%' }} min={0} step={10000} {...numFmt} /></Form.Item></Col>
            <Col span={12}><Form.Item name="coverageLimit" label="保額(賠償限額)"><InputNumber style={{ width: '100%' }} min={0} step={100000} {...numFmt} /></Form.Item></Col>
            <Col span={12}><Form.Item name="estimatedFee" label="預估公證費"><InputNumber style={{ width: '100%' }} min={0} step={10000} {...numFmt} /></Form.Item></Col>
            <Col span={24}><Divider style={{ margin: '4px 0 12px' }} /></Col>
            <Col span={12}><Form.Item name="adjustmentAmount" label="理算損失額"><InputNumber style={{ width: '100%' }} min={0} step={100000} {...numFmt} /></Form.Item></Col>
            <Col span={12}><Form.Item name="salvageValue" label="殘餘物價值"><InputNumber style={{ width: '100%' }} min={0} step={10000} {...numFmt} /></Form.Item></Col>
            <Col span={12}><Form.Item name="finalAmount" label="最終金額"><InputNumber style={{ width: '100%' }} min={0} step={100000} {...numFmt} /></Form.Item></Col>
            <Col span={12}><Form.Item name="actualFee" label="實際公證費"><InputNumber style={{ width: '100%' }} min={0} step={10000} {...numFmt} /></Form.Item></Col>
            <Col span={12}><Form.Item name="travelOtherExpense" label="差旅其他費" style={{ marginBottom: 0 }}><InputNumber style={{ width: '100%' }} min={0} step={100} placeholder="無出差請填 0" {...numFmt} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* ── 送審 Modal（FR-12/36/47/85/86）── */}
      <Modal title="送審文件" open={reviewModalOpen} onCancel={closeReviewModal} footer={null} width={600}>
        <Form form={reviewForm} layout="vertical" onFinish={handleSendReview} style={{ marginTop: 16 }}>
          {caseData.isSpecialCase && (
            <Card size="small" style={{ background: '#fff7e6', border: '1px solid #ffd591', marginBottom: 12 }}>
              <Space size={6}>
                <Tag color="red" style={{ fontWeight: 600, margin: 0 }}>特殊案件</Tag>
                <Text style={{ color: '#d46b08', fontSize: 13 }}>不論文件類型與金額，所有送審文件均需部門主管審核後轉執行副總閱示</Text>
              </Space>
            </Card>
          )}
          <Form.Item name="documentType" label="文件類型" rules={[{ required: true, message: '請選擇文件類型' }]}>
            <Select placeholder="選擇送審文件類型" options={DOCUMENT_TYPES.map((t) => ({ value: t, label: t }))} onChange={(v) => setSelectedDocType(v)} />
          </Form.Item>

          {selectedDocType && isDuplicatePending(selectedDocType) && (
            <Card size="small" style={{ background: '#fff2f0', border: '1px solid #ffccc7', marginBottom: 12 }}>
              <Text style={{ color: '#cf1322', fontSize: 13 }}>「{selectedDocType}」已有審核中記錄，不可重複送審</Text>
            </Card>
          )}

          {selectedDocType && TRAVEL_REQUIRED_DOCS.includes(selectedDocType) && caseData.travelOtherExpense == null && (
            <Card size="small" style={{ background: '#fff2f0', border: '1px solid #ffccc7', marginBottom: 12 }}>
              <Text style={{ color: '#cf1322', fontSize: 13 }}>送審此文件前，請關閉後至金額資訊區塊填寫「差旅其他費」（無出差請填 0）</Text>
            </Card>
          )}

          {selectedDocType && INTERIM_DOC_TYPES.includes(selectedDocType) && (
            <>
              <Divider titlePlacement="start" orientationMargin={0} style={{ fontSize: 12, color: '#1B4F8C', margin: '4px 0 10px' }}>中間報告資訊</Divider>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, marginBottom: 4 }}>
                <Form.Item name="interimType" label="類型" style={{ marginBottom: 0, flexShrink: 0 }}>
                  <Radio.Group>
                    {/* [2026/06/18] - Lisa - Issue #8 value 維持內部字串，顯示改為「追加實際公證費」 */}
                    <Radio value="追加預估公證費" style={{ fontSize: 13 }}>追加實際公證費</Radio>
                    <Radio value="公證費預付請款" style={{ fontSize: 13 }}>公證費預付請款</Radio>
                  </Radio.Group>
                </Form.Item>
                <Form.Item name="interimAmount" label="金額" style={{ marginBottom: 0, flex: 1 }}>
                  <InputNumber style={{ width: '100%' }} min={0} precision={0} placeholder="請輸入金額" controls={false} />
                </Form.Item>
              </div>
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12, color: '#d46b08' }}>※ 選擇「追加實際公證費」後送審，追加金額將直接累加至實際公證費，且不可撤回。</Text>
            </>
          )}

          {selectedDocType && (() => {
            const flow = getApprovalFlow(deptCode, selectedDocType, caseData.estimatedAmount, caseData.isSpecialCase)
            return (
              <>
                <Divider titlePlacement="start" orientationMargin={0} style={{ fontSize: 12, color: '#1B4F8C', margin: '4px 0 10px' }}>審核流程</Divider>
                <Steps
                  size="small" style={{ marginBottom: 12 }}
                  items={flow.steps.map((s, i) => ({
                    title: <span style={{ fontSize: 12 }}>{s.title}</span>,
                    description: <span style={{ fontSize: 11, color: '#888' }}>{s.desc}</span>,
                    status: (i === flow.steps.length - 1 && s.key === 'vp' ? 'finish' : 'process') as 'finish' | 'process',
                  }))}
                />
                {flow.notes.length > 0 && (
                  <>
                    <Divider titlePlacement="start" orientationMargin={0} style={{ fontSize: 12, color: '#d46b08', margin: '4px 0 8px' }}>注意事項</Divider>
                    <Card size="small" style={{ background: '#fffbe6', border: '1px solid #ffe58f', marginBottom: 12 }}>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {flow.notes.map((n, i) => <li key={i} style={{ fontSize: 12, color: '#614700', marginBottom: 3 }}>{n}</li>)}
                      </ul>
                    </Card>
                  </>
                )}
              </>
            )
          })()}

          <Divider titlePlacement="start" orientationMargin={0} style={{ fontSize: 12, color: '#555', margin: '4px 0 10px' }}>隨附文件勾選（選填）</Divider>
          <Form.Item name="checkedDocuments" style={{ marginBottom: 12 }}>
            <Checkbox.Group style={{ width: '100%' }}>
              <Row gutter={[0, 6]}>
                {ATTACH_DOC_OPTIONS.map((t) => <Col span={12} key={t}><Checkbox value={t} style={{ fontSize: 13 }}>{t}</Checkbox></Col>)}
              </Row>
            </Checkbox.Group>
          </Form.Item>

          <Form.Item name="submissionNotes" label="送審說明（選填）"><Input.TextArea rows={2} placeholder="補充說明..." /></Form.Item>
          <Row justify="end">
            <Space>
              <Button onClick={closeReviewModal}>取消</Button>
              {selectedDocType && isDuplicatePending(selectedDocType) ? (
                <Button disabled>⚠ 審核中，無法送審</Button>
              ) : (
                <Button type="primary" htmlType="submit" style={{ background: '#1B4F8C' }}>確認送審</Button>
              )}
            </Space>
          </Row>
        </Form>
      </Modal>

      {/* ── 審核退回 Modal（FR-64）── */}
      <Modal
        title="退回意見" open={reviewerRejectOpen}
        onCancel={() => { setReviewerRejectOpen(false); reviewerRejectForm.resetFields() }}
        onOk={() => reviewerRejectForm.submit()} okText="確認退回" cancelText="取消" okButtonProps={{ danger: true }}
      >
        <Form form={reviewerRejectForm} layout="vertical" onFinish={handleReviewerReject} style={{ marginTop: 16 }}>
          <Form.Item name="rejectReason" label="退回原因" rules={[{ required: true, message: '退回原因必填' }]}>
            <Input.TextArea rows={3} placeholder="請說明退回原因及需修正事項..." />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
