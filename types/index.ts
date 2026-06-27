import type { JWTPayload, RoleInfo } from '@/lib/auth'

export type { JWTPayload, RoleInfo }

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
  total?: number
  page?: number
  pageSize?: number
}

// ── Auth ─────────────────────────────────────────────────────────────────
export interface LoginPayload {
  username: string
  password: string
  roleIndex?: number
}

// ── User ─────────────────────────────────────────────────────────────────
export interface UserProfile {
  id: number
  name: string
  username: string
  email: string | null
  isActive: boolean
  roles: RoleInfo[]
}

// ── Case ─────────────────────────────────────────────────────────────────
export type CaseStatus = '未決' | '已決' | '銷案'
export type ContactFormStatus = '無' | '待傳' | '已回傳'

export interface CaseListItem {
  id: number
  caseNumber: string
  departmentId: number
  departmentName: string
  insuranceCompanyId: number
  insuranceCompanyName: string
  insuredName: string
  insuranceType: string
  incidentDate: string
  commissionDate: string
  status: CaseStatus
  currentStage: string
  estimatedAmount: number | null
  estimatedFee: number | null
  actualFee: number | null
  handlers: { id: number; name: string; role: string }[]
  slaStatus?: 'green' | 'yellow' | 'red'
}

export interface CaseDetail extends CaseListItem {
  policyNumber: string
  incidentLocation: string
  incidentCause: string
  brokerCompanyId: number | null
  brokerCompanyName: string | null
  insuranceContact: string | null
  deductible: number | null
  adjustmentAmount: number | null
  salvageValue: number | null
  finalAmount: number | null
  travelOtherExpense: number | null
  preliminaryReportDate: string | null
  finalReportDate: string | null
  closeDate: string | null
  contactFormStatus: string | null
  contactReturnDate: string | null
  nasFolder: string | null
  parkingStatus: string | null
  isSpecialCase: boolean
  notes: string | null
  coInsurers: CoInsurer[]
  assignments: CaseAssignment[]
  progress: CaseProgress[]
  caseNotes: CaseNote[]
  logs: CaseLog[]
  reviews: CaseReview[]
  settlement: Settlement | null
}

export interface CoInsurer {
  id: number
  companyId: number | null
  companyName: string | null
  policyNumber: string
  ratio: number
}

export interface CaseAssignment {
  id: number
  employeeId: number
  employeeName: string
  role: string
  contributionRatio: number
}

export interface CaseProgress {
  id: number
  stage: string
  progressDate: string
  description: string | null
  createdBy: number
  creatorName: string
}

export interface CaseNote {
  id: number
  noteDate: string
  content: string
  createdBy: number
  creatorName: string
}

export interface CaseLog {
  id: number
  changedAt: string
  fieldName: string
  oldValue: string | null
  newValue: string | null
  logType: string
  amount: number | null
  employeeId: number
  employeeName: string
}

// ── Review ───────────────────────────────────────────────────────────────
export interface CaseReview {
  id: number
  caseId: number
  caseNumber: string
  documentType: string
  checkedDocuments: string | null
  submittedBy: number
  submitterName: string
  submittedAt: string
  submissionNotes: string | null
  reviewerId: number
  reviewerName: string
  reviewStatus: string
  reviewRemarks: string | null
  reviewedAt: string | null
  requiresVP: boolean
  approverId: number | null
  approverName: string | null
  approvalStatus: string | null
  approvalRemarks: string | null
  approvedAt: string | null
  requiresMidApproval: boolean
  midApproverId: number | null
  midApproverName: string | null
  midApprovalStatus: string | null
  midApprovalRemarks: string | null
  midApprovedAt: string | null
  interimTypes: string | null
  interimAmount: number | null
  feeReversed: boolean
}

// ── Settlement ────────────────────────────────────────────────────────────
export interface Settlement {
  id: number
  caseId: number
  reportDate: string
  baseFee: number
  travelExpense: number
  totalFee: number
  remarks: string | null
  splits: SettlementSplit[]
}

export interface SettlementSplit {
  id: number
  employeeId: number
  employeeName: string
  ratio: number
  amount: number
}

// ── Dispatch ─────────────────────────────────────────────────────────────
export interface DispatchItem {
  id: number
  sourceType: string
  sourceReference: string
  insuranceCompanyId: number
  insuranceCompanyName: string
  brokerCompanyId: number | null
  brokerCompanyName: string | null
  assignedDepartmentId: number
  assignedDepartmentName: string
  assignmentNotes: string | null
  status: string
  assignedBy: number
  assignerName: string
  pickedBy: number | null
  pickerName: string | null
  createdAt: string
  draftData: string | null
}

// ── Notification ──────────────────────────────────────────────────────────
export interface NotificationItem {
  id: number
  type: string
  title: string
  message: string
  caseId: number | null
  caseNumber: string | null
  targetRoles: string
  isRead: boolean
  createdAt: string
}

// ── FeeTarget ─────────────────────────────────────────────────────────────
export interface FeeTarget {
  id: number
  employeeId: number
  employeeName: string
  year: number
  targetAmount: number | null
  targetCaseCount: number | null
  setBy: number
  setByName: string
  setAt: string
}

// ── Master Data ───────────────────────────────────────────────────────────
export interface Region { id: number; name: string; code: string }
export interface Department { id: number; name: string; code: string; regionId: number; regionName: string }
export interface InsuranceCompany { id: number; code: string; name: string }
export interface BrokerCompany { id: number; name: string; isActive: boolean }
export interface InsuranceType { id: number; name: string; feeCategory: string; isActive: boolean }
export interface IncidentLocation { id: number; name: string; isActive: boolean }
