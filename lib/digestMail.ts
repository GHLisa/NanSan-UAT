// ── 排程彙整郵件 ─────────────────────────────────────────────────────────
// 每日 07:00（台北）由 /api/cron/daily-digest 觸發，分兩項工作：
//
// (1) 每日彙整（每天執行）：
//   a. 今日新進入黃燈（D+14）案件        → 主承辦人（其組長收彙整單，見 c-組長）
//   b. 仍未決案件（送審中未完成簽核者備註）→ 主承辦人（同上）
//   c. 待審文件                          → 各審核人員（依當前關卡 = 複核 / 加簽 / 副總）
//   另：每位組長收一封彙整其組內所有承辦人之 a+b 案件的信。
//
// (2) 每週部門彙整（僅星期一執行）：
//   各部門未決案件中黃 / 紅燈清單 → 該部門主管，副本執行副總。
//
// 燈號定義沿用 lib/sla.ts（與儀表板一致：黃 D+14、紅 D+30 / D+90）。
// PS 規則「無 email 不發送」由 lib/email.ts sendMail 統一保證。
// 所有寄送皆以 safeSend 包裝：失敗只記 log、不拋例外，確保排程不中斷。

import { type Dayjs } from 'dayjs'
import { prisma } from './prisma'
import { sendMail } from './email'
import {
  type SlaStatus,
  getSlaStatus,
  daysSinceCommission,
  isNewlyYellowToday,
  taipeiNow,
} from './sla'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? ''

// ── 共用：收件人格式、HTML 模板、燈號徽章 ───────────────────────────────
function formatRecipient(name: string | null | undefined, email: string): string {
  return name ? `${name} <${email}>` : email
}

function caseLink(caseId: number, label: string): string {
  if (!APP_URL) return label
  return `<a href="${APP_URL.replace(/\/$/, '')}/cases/${caseId}" style="color:#2E86C1;text-decoration:none">${label}</a>`
}

function lightBadge(s: SlaStatus): string {
  const map: Record<SlaStatus, [string, string]> = {
    red: ['#E53E3E', '紅燈'],
    yellow: ['#D69E2E', '黃燈'],
    normal: ['#A0AEC0', '正常'],
  }
  const [bg, label] = map[s]
  return `<span style="display:inline-block;background:${bg};color:#fff;font-size:12px;padding:1px 8px;border-radius:10px">${label}</span>`
}

function shell(title: string, intro: string, body: string): string {
  return `<div style="font-family:'Microsoft JhengHei',sans-serif;font-size:14px;color:#1A202C;line-height:1.6">
    <h2 style="color:#1B4F8C;margin:0 0 8px">${title}</h2>
    <p style="margin:0 0 12px;color:#444">${intro}</p>
    ${body}
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
    <p style="color:#888;font-size:12px">南山公證案件管理系統自動通知，請勿直接回覆此信。</p>
  </div>`
}

// 案件列（彙整表格的一筆資料）
interface CaseRow {
  id: number
  caseNumber: string
  insuredName: string
  departmentName: string
  commissionDate: Date
  daysSince: number
  light: SlaStatus
  note: string      // 送審中關卡備註 / 承辦人名等
}

function caseTable(rows: CaseRow[], noteHeader = '備註'): string {
  if (rows.length === 0) return '<p style="color:#888;margin:4px 0">（無）</p>'
  const th = (t: string) =>
    `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #1B4F8C;font-size:13px;color:#1B4F8C;white-space:nowrap">${t}</th>`
  const td = (t: string) =>
    `<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top">${t}</td>`
  const head = `<tr>${th('案號')}${th('被保險人')}${th('部門')}${th('委辦日')}${th('已逾天數')}${th('燈號')}${th(noteHeader)}</tr>`
  const body = rows
    .map(
      r =>
        `<tr>${td(caseLink(r.id, r.caseNumber))}${td(r.insuredName)}${td(r.departmentName)}` +
        `${td(r.commissionDate.toISOString().slice(0, 10))}${td(`${r.daysSince} 天`)}` +
        `${td(lightBadge(r.light))}${td(r.note || '—')}</tr>`,
    )
    .join('')
  return `<table style="border-collapse:collapse;width:100%;margin:4px 0 12px"><thead>${head}</thead><tbody>${body}</tbody></table>`
}

// 安全寄送：永不拋例外
async function safeSend(
  to: string[],
  subject: string,
  html: string,
  category: string,
  cc?: string[],
): Promise<boolean> {
  try {
    const r = await sendMail({ to, cc, subject, html, category })
    if (!r.ok) console.error('[digestMail] 寄送失敗：', subject, r.error)
    return r.ok && r.sent > 0
  } catch (e) {
    console.error('[digestMail] 寄送例外：', subject, e)
    return false
  }
}

// ── 內部型別 ─────────────────────────────────────────────────────────────
interface Assignee {
  employeeId: number
  role: string            // 主辦 / 協辦
  name: string
  email: string | null
}

interface OpenCase {
  id: number
  caseNumber: string
  insuredName: string
  commissionDate: Date
  preliminaryReportDate: Date | null
  status: string
  departmentId: number
  departmentName: string
  assignees: Assignee[]
  pendingGate: string | null   // 送審中尚未完成簽核之關卡（null = 非送審中）
}

// 送審中尚未完成簽核 → 當前關卡描述（取最靠後的待辦關卡）
function pendingGateOf(reviews: {
  reviewStatus: string
  midApprovalStatus: string | null
  approvalStatus: string | null
}[]): string | null {
  for (const rv of reviews) {
    if (rv.approvalStatus === '待執行副總閱') return '送審中：待執行副總審閱'
    if (rv.midApprovalStatus === '待加簽審核') return '送審中：待加簽審核'
    if (rv.reviewStatus === '待複核') return '送審中：待部門主管複核'
  }
  return null
}

function primaryOf(c: OpenCase): Assignee | null {
  return c.assignees.find(a => a.role === '主辦') ?? c.assignees[0] ?? null
}

// ── 載入所有未決案件（含承辦人與進行中送審紀錄）─────────────────────────
async function loadOpenCases(): Promise<OpenCase[]> {
  const rows = await prisma.case.findMany({
    where: { status: '未決' },
    select: {
      id: true,
      caseNumber: true,
      insuredName: true,
      commissionDate: true,
      preliminaryReportDate: true,
      status: true,
      departmentId: true,
      department: { select: { name: true } },
      assignments: {
        select: { role: true, employee: { select: { id: true, name: true, email: true } } },
      },
      // recordStatus null = 進行中（未被重送 / 放棄取代）
      reviews: {
        where: { recordStatus: null },
        select: { reviewStatus: true, midApprovalStatus: true, approvalStatus: true },
      },
    },
  })
  return rows.map(c => ({
    id: c.id,
    caseNumber: c.caseNumber,
    insuredName: c.insuredName,
    commissionDate: c.commissionDate,
    preliminaryReportDate: c.preliminaryReportDate,
    status: c.status,
    departmentId: c.departmentId,
    departmentName: c.department.name,
    assignees: c.assignments.map(a => ({
      employeeId: a.employee.id,
      role: a.role,
      name: a.employee.name,
      email: a.employee.email,
    })),
    pendingGate: pendingGateOf(c.reviews),
  }))
}

function toRow(c: OpenCase, now: Dayjs, note: string): CaseRow {
  return {
    id: c.id,
    caseNumber: c.caseNumber,
    insuredName: c.insuredName,
    departmentName: c.departmentName,
    commissionDate: c.commissionDate,
    daysSince: daysSinceCommission(c.commissionDate, now),
    light: getSlaStatus(c.commissionDate, c.preliminaryReportDate, c.status, now),
    note,
  }
}

export interface DailyDigestResult {
  handlerMailsSent: number
  groupMailsSent: number
  reviewerMailsSent: number
}

// ── (1) 每日彙整 ─────────────────────────────────────────────────────────
export async function runDailyDigest(now: Dayjs = taipeiNow()): Promise<DailyDigestResult> {
  const openCases = await loadOpenCases()

  // 主承辦人分組：employeeId → { handler 基本資料, 案件清單 }
  const byPrimary = new Map<number, { handler: Assignee; cases: OpenCase[] }>()
  for (const c of openCases) {
    const p = primaryOf(c)
    if (!p) continue
    const bucket = byPrimary.get(p.employeeId) ?? { handler: p, cases: [] }
    bucket.cases.push(c)
    byPrimary.set(p.employeeId, bucket)
  }

  // a. 今日新進入黃燈案件對照表（caseId → 是否新黃燈），供分區呈現
  const isNewYellow = (c: OpenCase) =>
    isNewlyYellowToday(c.commissionDate, c.preliminaryReportDate, c.status, now)

  // ── a + b：每位主承辦人一封信 ─────────────────────────────────────────
  let handlerMailsSent = 0
  for (const { handler, cases } of Array.from(byPrimary.values())) {
    const newYellow = cases.filter(isNewYellow).map(c => toRow(c, now, ''))
    const allOpen = cases.map(c => toRow(c, now, c.pendingGate ?? ''))
    const body =
      `<h3 style="color:#D69E2E;margin:16px 0 4px;font-size:15px">① 今日新進入黃燈（D+14）案件　${newYellow.length} 件</h3>` +
      caseTable(newYellow) +
      `<h3 style="color:#1B4F8C;margin:16px 0 4px;font-size:15px">② 您仍未決的案件　${allOpen.length} 件</h3>` +
      caseTable(allOpen, '狀態備註')
    const html = shell(
      `每日案件提醒　${handler.name}`,
      `以下為您目前承辦（主辦）的待辦案件彙整，請及時處理逾期案件。`,
      body,
    )
    const to = handler.email ? [formatRecipient(handler.name, handler.email)] : []
    const ok = await safeSend(
      to,
      `【每日案件提醒】${handler.name}　未決 ${allOpen.length} 件（新黃燈 ${newYellow.length}）`,
      html,
      'daily_handler_digest',
    )
    if (ok) handlerMailsSent++
  }

  // ── a + b 之組長彙整：每位組長一封，涵蓋其組內所有承辦人之案件 ─────────
  // 建立「承辦人(在某部門)的組別」對照，與「部門+組別 → 組長」對照
  const roleRows = await prisma.employeeRole.findMany({
    where: { role: { in: ['handler', 'team_lead'] } },
    select: {
      employeeId: true,
      departmentId: true,
      role: true,
      teamGroup: true,
      employee: { select: { id: true, name: true, email: true } },
    },
  })
  // handlerGroup：`${employeeId}:${departmentId}` → teamGroup
  const handlerGroup = new Map<string, string | null>()
  // leads：每位 team_lead 一筆
  interface Lead {
    employeeId: number
    departmentId: number
    teamGroup: string | null
    name: string
    email: string | null
  }
  const leads: Lead[] = []
  for (const r of roleRows) {
    if (r.role === 'handler') {
      handlerGroup.set(`${r.employeeId}:${r.departmentId}`, r.teamGroup)
    } else if (r.role === 'team_lead') {
      leads.push({
        employeeId: r.employeeId,
        departmentId: r.departmentId ?? -1,
        teamGroup: r.teamGroup,
        name: r.employee.name,
        email: r.employee.email,
      })
    }
  }

  // 為每個案件標記其（部門, 組別）— 以主承辦人在該案部門的組別為準
  function caseGroupKey(c: OpenCase): string | null {
    const p = primaryOf(c)
    if (!p) return null
    const g = handlerGroup.get(`${p.employeeId}:${c.departmentId}`)
    // 組別可能為 null（fallback 整部門）；統一以字串化 key 表示
    return `${c.departmentId}:${g ?? ''}`
  }

  let groupMailsSent = 0
  for (const lead of leads) {
    // 組長負責範圍：同部門同組別；teamGroup 為空時 fallback 整部門所有組
    const leadKey = `${lead.departmentId}:${lead.teamGroup ?? ''}`
    const inScope = openCases.filter(c => {
      const ck = caseGroupKey(c)
      if (!ck) return false
      if (lead.teamGroup) return ck === leadKey
      // 組長無 teamGroup → 整部門
      return c.departmentId === lead.departmentId
    })
    if (inScope.length === 0) continue

    const newYellow = inScope.filter(isNewYellow)
    const rowsNew = newYellow.map(c => toRow(c, now, `主辦：${primaryOf(c)?.name ?? '—'}`))
    const rowsAll = inScope.map(c =>
      toRow(c, now, [primaryOf(c)?.name ? `主辦：${primaryOf(c)?.name}` : '', c.pendingGate ?? ''].filter(Boolean).join('｜')),
    )
    const body =
      `<h3 style="color:#D69E2E;margin:16px 0 4px;font-size:15px">① 今日新進入黃燈（D+14）案件　${rowsNew.length} 件</h3>` +
      caseTable(rowsNew, '主辦') +
      `<h3 style="color:#1B4F8C;margin:16px 0 4px;font-size:15px">② 組內未決案件　${rowsAll.length} 件</h3>` +
      caseTable(rowsAll, '主辦／狀態')
    const groupLabel = lead.teamGroup ? lead.teamGroup : '全部門'
    const html = shell(
      `每日組別彙整　${lead.name}（${groupLabel}）`,
      `以下為您所屬組別承辦人的未決案件彙整，請督導逾期案件處理。`,
      body,
    )
    const to = lead.email ? [formatRecipient(lead.name, lead.email)] : []
    const ok = await safeSend(
      to,
      `【每日組別彙整】${groupLabel}　未決 ${rowsAll.length} 件（新黃燈 ${rowsNew.length}）`,
      html,
      'daily_group_digest',
    )
    if (ok) groupMailsSent++
  }

  // ── c：待審文件 → 各審核人員 ─────────────────────────────────────────
  const reviewerMailsSent = await runReviewerDigest()

  return { handlerMailsSent, groupMailsSent, reviewerMailsSent }
}

// ── (1c) 待審文件彙整 ────────────────────────────────────────────────────
// 待審文件依「送審日」呈現、不涉及 SLA 燈號，故無需 now 參數。
async function runReviewerDigest(): Promise<number> {
  const pending = await prisma.caseReview.findMany({
    where: {
      recordStatus: null,
      OR: [
        { reviewStatus: '待複核' },
        { midApprovalStatus: '待加簽審核' },
        { approvalStatus: '待執行副總閱' },
      ],
    },
    select: {
      documentType: true,
      submittedAt: true,
      reviewStatus: true,
      midApprovalStatus: true,
      approvalStatus: true,
      reviewer: { select: { id: true, name: true, email: true } },
      midApprover: { select: { id: true, name: true, email: true } },
      approver: { select: { id: true, name: true, email: true } },
      case: { select: { id: true, caseNumber: true, insuredName: true } },
    },
  })

  interface PendingDoc {
    caseId: number
    caseNumber: string
    insuredName: string
    documentType: string
    gate: string
    submittedAt: Date
  }
  // 依「當前負責審核人」分組
  const byReviewer = new Map<number, { name: string; email: string | null; docs: PendingDoc[] }>()
  for (const r of pending) {
    // 取最靠後的待辦關卡與其負責人
    let person: { id: number; name: string; email: string | null } | null = null
    let gate = ''
    if (r.approvalStatus === '待執行副總閱' && r.approver) {
      person = r.approver
      gate = '執行副總審閱'
    } else if (r.midApprovalStatus === '待加簽審核' && r.midApprover) {
      person = r.midApprover
      gate = '加簽審核'
    } else if (r.reviewStatus === '待複核') {
      person = r.reviewer
      gate = '部門主管複核'
    }
    if (!person) continue
    const bucket = byReviewer.get(person.id) ?? { name: person.name, email: person.email, docs: [] }
    bucket.docs.push({
      caseId: r.case.id,
      caseNumber: r.case.caseNumber,
      insuredName: r.case.insuredName,
      documentType: r.documentType,
      gate,
      submittedAt: r.submittedAt,
    })
    byReviewer.set(person.id, bucket)
  }

  let sent = 0
  for (const { name, email, docs } of Array.from(byReviewer.values())) {
    const th = (t: string) =>
      `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #1B4F8C;font-size:13px;color:#1B4F8C;white-space:nowrap">${t}</th>`
    const td = (t: string) =>
      `<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px">${t}</td>`
    const head = `<tr>${th('案號')}${th('被保險人')}${th('文件類型')}${th('審核關卡')}${th('送審日')}</tr>`
    const body = docs
      .map(
        d =>
          `<tr>${td(caseLink(d.caseId, d.caseNumber))}${td(d.insuredName)}${td(d.documentType)}` +
          `${td(d.gate)}${td(d.submittedAt.toISOString().slice(0, 10))}</tr>`,
      )
      .join('')
    const table = `<table style="border-collapse:collapse;width:100%;margin:4px 0 12px"><thead>${head}</thead><tbody>${body}</tbody></table>`
    const html = shell(
      `每日待審文件提醒　${name}`,
      `以下為待您審核的文件，共 ${docs.length} 份，請至系統進行審核。`,
      table,
    )
    const to = email ? [formatRecipient(name, email)] : []
    const ok = await safeSend(
      to,
      `【每日待審文件】${name}　${docs.length} 份`,
      html,
      'daily_reviewer_digest',
    )
    if (ok) sent++
  }
  return sent
}

export interface WeeklyReportResult {
  deptMailsSent: number
}

// ── (2) 每週部門彙整（僅星期一）→ 部門主管，副本執行副總 ─────────────────
export async function runWeeklyDeptReport(now: Dayjs = taipeiNow()): Promise<WeeklyReportResult> {
  const openCases = await loadOpenCases()

  // 部門主管：departmentId → [{name,email}]
  const mgrRows = await prisma.employeeRole.findMany({
    where: { role: 'dept_manager' },
    select: { departmentId: true, employee: { select: { name: true, email: true } } },
  })
  const mgrByDept = new Map<number, { name: string; email: string | null }[]>()
  for (const m of mgrRows) {
    if (m.departmentId == null) continue
    const arr = mgrByDept.get(m.departmentId) ?? []
    arr.push({ name: m.employee.name, email: m.employee.email })
    mgrByDept.set(m.departmentId, arr)
  }

  // 執行副總（副本收件）
  const vpRows = await prisma.employeeRole.findMany({
    where: { role: 'vp' },
    select: { employee: { select: { name: true, email: true } } },
  })
  const vpCc = vpRows
    .filter(v => !!v.employee.email)
    .map(v => formatRecipient(v.employee.name, v.employee.email as string))

  // 依部門分組，僅保留黃 / 紅燈
  const byDept = new Map<number, { name: string; rows: CaseRow[] }>()
  for (const c of openCases) {
    const light = getSlaStatus(c.commissionDate, c.preliminaryReportDate, c.status, now)
    if (light === 'normal') continue
    const bucket = byDept.get(c.departmentId) ?? { name: c.departmentName, rows: [] }
    bucket.rows.push(toRow(c, now, primaryOf(c)?.name ? `主辦：${primaryOf(c)?.name}` : ''))
    byDept.set(c.departmentId, bucket)
  }

  let deptMailsSent = 0
  for (const [deptId, { name, rows }] of Array.from(byDept.entries())) {
    const managers = mgrByDept.get(deptId) ?? []
    const to = managers
      .filter(m => !!m.email)
      .map(m => formatRecipient(m.name, m.email as string))

    const red = rows.filter(r => r.light === 'red').sort((a, b) => b.daysSince - a.daysSince)
    const yellow = rows.filter(r => r.light === 'yellow').sort((a, b) => b.daysSince - a.daysSince)
    const body =
      `<h3 style="color:#E53E3E;margin:16px 0 4px;font-size:15px">🔴 紅燈案件（D+30 未交初報／D+90 未決）　${red.length} 件</h3>` +
      caseTable(red, '主辦') +
      `<h3 style="color:#D69E2E;margin:16px 0 4px;font-size:15px">🟡 黃燈案件（D+14 未交初報）　${yellow.length} 件</h3>` +
      caseTable(yellow, '主辦')
    const html = shell(
      `每週部門未決彙整　${name}`,
      `以下為貴部門目前未決且已亮燈的案件清單，請督導承辦人加速處理。`,
      body,
    )
    const ok = await safeSend(
      to,
      `【每週部門未決彙整】${name}　紅 ${red.length} / 黃 ${yellow.length} 件`,
      html,
      'weekly_dept_report',
      vpCc,
    )
    if (ok) deptMailsSent++
  }

  return { deptMailsSent }
}

// ── (3) 即時事件批次彙整（台北平日 08:00 / 16:00）→ 依收件人各一封 ─────────
// 由 /api/cron/event-digest 觸發：把 mail_event_queue 中待寄事件依收件人彙整成單封信，
// 寄成功後標記 sentAt；失敗則留待下一時段重試（sendMail 本身另有退避重試）。
export interface EventDigestResult {
  mailsSent: number
  eventsFlushed: number
}

interface QueuedEvent {
  id: number
  eventType: string
  caseId: number | null
  caseNumber: string
  insuredName: string | null
  documentType: string | null
  remarks: string | null
}

export function buildEventDigestHtml(events: QueuedEvent[]): string {
  const th = (t: string) =>
    `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #1B4F8C;font-size:13px;color:#1B4F8C;white-space:nowrap">${t}</th>`
  const td = (t: string) =>
    `<td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top">${t}</td>`
  const caseCell = (e: QueuedEvent) => (e.caseId ? caseLink(e.caseId, e.caseNumber) : e.caseNumber)

  const section = (title: string, color: string, headCols: string, rowsHtml: string) =>
    `<h3 style="color:${color};margin:16px 0 4px;font-size:15px">${title}</h3>` +
    `<table style="border-collapse:collapse;width:100%;margin:4px 0 12px"><thead><tr>${headCols}</tr></thead><tbody>${rowsHtml}</tbody></table>`

  const pick = (type: string | string[]) => {
    const types = Array.isArray(type) ? type : [type]
    return events.filter(e => types.includes(e.eventType))
  }

  let body = ''

  const assignNew = pick('new_assignment')
  if (assignNew.length) {
    const rows = assignNew.map(e => `<tr>${td(caseCell(e))}${td(e.insuredName ?? '—')}</tr>`).join('')
    body += section(`🆕 新派案　${assignNew.length} 件`, '#1B4F8C', `${th('案號')}${th('被保險人')}`, rows)
  }

  const assignChg = pick('assignment_changed')
  if (assignChg.length) {
    const rows = assignChg.map(e => `<tr>${td(caseCell(e))}${td(e.insuredName ?? '—')}</tr>`).join('')
    body += section(`🔁 承辦人異動　${assignChg.length} 件`, '#1B4F8C', `${th('案號')}${th('被保險人')}`, rows)
  }

  const toReview = pick(['review_submitted', 'review_cascade'])
  if (toReview.length) {
    const rows = toReview.map(e => `<tr>${td(caseCell(e))}${td(e.insuredName ?? '—')}${td(e.documentType ?? '—')}</tr>`).join('')
    body += section(`📄 待您審核的文件　${toReview.length} 件`, '#2E7D32', `${th('案號')}${th('被保險人')}${th('文件類型')}`, rows)
  }

  const rejected = pick('review_rejected')
  if (rejected.length) {
    const rows = rejected
      .map(e => `<tr>${td(caseCell(e))}${td(e.insuredName ?? '—')}${td(e.documentType ?? '—')}${td(e.remarks ?? '—')}</tr>`)
      .join('')
    body += section(`↩️ 文件退回　${rejected.length} 件`, '#E53E3E', `${th('案號')}${th('被保險人')}${th('文件類型')}${th('退回原因')}`, rows)
  }

  return shell(
    '案件待辦彙整',
    '以下為上一時段以來與您相關的案件通知，請至系統處理。',
    body,
  )
}

export async function runEventDigest(): Promise<EventDigestResult> {
  const pending = await prisma.mailEventQueue.findMany({
    where: { sentAt: null },
    orderBy: { createdAt: 'asc' },
  })
  if (pending.length === 0) return { mailsSent: 0, eventsFlushed: 0 }

  // 依收件人分組
  const byRecipient = new Map<string, QueuedEvent[]>()
  for (const e of pending) {
    const arr = byRecipient.get(e.recipient) ?? []
    arr.push(e)
    byRecipient.set(e.recipient, arr)
  }

  let mailsSent = 0
  let eventsFlushed = 0
  for (const [recipient, events] of Array.from(byRecipient.entries())) {
    const html = buildEventDigestHtml(events)
    const ok = await safeSend(
      [recipient],
      `【案件待辦彙整】您有 ${events.length} 則新通知`,
      html,
      'event_digest',
    )
    if (ok) {
      // 僅標記本封確實寄出的事件；失敗者留待下一時段
      await prisma.mailEventQueue.updateMany({
        where: { id: { in: events.map(e => e.id) } },
        data: { sentAt: new Date() },
      })
      mailsSent++
      eventsFlushed += events.length
    }
  }
  return { mailsSent, eventsFlushed }
}
