'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  Layout, Menu, Avatar, Dropdown, Badge, Typography, Space,
  Select, Button, Drawer, Alert,
} from 'antd'
import {
  DashboardOutlined, FileTextOutlined, InboxOutlined, CheckCircleOutlined,
  BarChartOutlined, SettingOutlined, BellOutlined, LogoutOutlined, UserOutlined,
  SwapOutlined, PercentageOutlined, LineChartOutlined, AccountBookOutlined,
  FundOutlined, ProfileOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  AppstoreOutlined, FileSearchOutlined, TrophyOutlined,
} from '@ant-design/icons'
import { useAuth } from './AuthProvider'
import { getMenuPermissions } from '@/lib/permissions'
import { api } from '@/lib/api'

const SIDER_COLLAPSED_KEY = 'nansan_sider_collapsed'

const { Sider, Header, Content } = Layout
const { Text } = Typography

const ALL_MENU_ITEMS = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '儀表板', path: '/dashboard' },
  { key: 'dispatch', icon: <InboxOutlined />, label: '派案池', path: '/dispatch' },
  { key: 'cases', icon: <FileTextOutlined />, label: '案件管理', path: '/cases' },
  { key: 'reviews', icon: <CheckCircleOutlined />, label: '文件審核', path: '/reviews' },
  { key: 'fee-target', icon: <TrophyOutlined />, label: '純公證費業績設定', path: '/performance' },
  { key: 'admin-fee', icon: <PercentageOutlined />, label: '費率表', path: '/admin/fee-rates' },
  {
    key: 'admin', icon: <SettingOutlined />, label: '系統管理',
    children: [
      { key: 'admin-users', label: '使用者帳號', path: '/admin/users' },
      { key: 'admin-master', label: '基礎資料', path: '/admin/master-data' },
      { key: 'admin-maillog', label: '發信紀錄', path: '/admin/mail-logs' },
      { key: 'admin-loginlog', label: '登入紀錄', path: '/admin/login-logs' },
    ],
  },
  { key: 'settlements', icon: <FileSearchOutlined />, label: '案件查詢', path: '/settlements' },
  { key: 'reports', icon: <BarChartOutlined />, label: '年度案件統計', path: '/reports' },
  { key: 'case-year-report', icon: <LineChartOutlined />, label: '各年度已決&未決案件數', path: '/reports/yearly' },
  { key: 'fee-year-report', icon: <AccountBookOutlined />, label: '各年度已決&未決公證費', path: '/reports/fee-yearly' },
  { key: 'open-fee-report', icon: <FundOutlined />, label: '各員工未決件數&預估公證費', path: '/reports/open-fee' },
  { key: 'case-detail-report', icon: <ProfileOutlined />, label: '已決案明細表', path: '/reports/case-detail' },
  { key: 'notifications', icon: <BellOutlined />, label: '通知', path: '/notifications' },
]

const MENU_GROUPS = [
  { key: 'grp-main', icon: <AppstoreOutlined />, label: '主要功能', keys: ['dashboard', 'dispatch', 'cases', 'reviews', 'fee-target', 'notifications'] },
  { key: 'grp-reports', icon: <BarChartOutlined />, label: '查詢統計管理', keys: ['settlements', 'reports', 'case-year-report', 'fee-year-report', 'open-fee-report', 'case-detail-report'] },
  { key: 'grp-admin', icon: <SettingOutlined />, label: '系統管理', keys: ['admin-fee'], flatten: 'admin' },
]

function buildMenuItems(permissions: string[], dispatchCount: number, myCaseCount: number, reviewCount: number) {
  // FR-38：派案池 / 案件管理 / 文件審核 顯示 badge（數字為 0 時 antd Badge 自動隱藏）
  const badgeCounts: Record<string, number> = { dispatch: dispatchCount, cases: myCaseCount, reviews: reviewCount }

  const buildLabel = (key: string, label: string) =>
    badgeCounts[key] != null
      ? (
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingRight: 4 }}>
          <span>{label}</span>
          <Badge count={badgeCounts[key]} size="small" offset={[8, 0]} />
        </span>
      )
      : label

  const groupLabel = (text: string) => (
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: '#7FBAFF', textTransform: 'uppercase' }}>
      {text}
    </span>
  )

  return MENU_GROUPS
    .map((group) => {
      const keyChildren = ALL_MENU_ITEMS
        .filter((item) => (group.keys ?? []).includes(item.key) && permissions.includes(item.key))
        .map((item) => ({ key: item.key, icon: item.icon, label: buildLabel(item.key, item.label) }))

      const flatChildren = group.flatten
        ? (() => {
            const parent = ALL_MENU_ITEMS.find((i) => i.key === group.flatten)
            if (!parent || !permissions.includes(group.flatten!)) return []
            return (parent.children ?? []).map((c) => ({ key: c.key, label: c.label }))
          })()
        : []

      const children = [...keyChildren, ...flatChildren]
      return children.length > 0
        ? { key: group.key, icon: group.icon, label: groupLabel(group.label), children }
        : null
    })
    .filter(Boolean)
}

function findPath(key: string): string {
  for (const item of ALL_MENU_ITEMS) {
    if (item.key === key) return item.path ?? '/'
    if (item.children) {
      const child = item.children.find((c) => c.key === key)
      if (child) return child.path ?? '/'
    }
  }
  return '/'
}

function isMenuKey(key: string): boolean {
  return ALL_MENU_ITEMS.some((i) => i.key === key || (i.children?.some((c) => c.key === key) ?? false))
}

function getSelectedKeys(pathname: string, from?: string | null): string[] {
  // [2026/06/18] - Lisa - 從其他模組（文件審核 / 案件查詢…）點進案件明細（/cases/[id]?from=<選單key>）時，
  // 選單仍 highlight 在來源模組，避免 focus 跳到「案件管理」
  if (from && pathname.startsWith('/cases') && isMenuKey(from)) return [from]
  const candidates: { key: string; len: number }[] = []
  for (const item of ALL_MENU_ITEMS) {
    if (item.children) {
      for (const child of item.children) {
        if (child.path && pathname.startsWith(child.path)) {
          candidates.push({ key: child.key, len: child.path.length })
        }
      }
    } else if (item.path && pathname.startsWith(item.path)) {
      candidates.push({ key: item.key, len: item.path.length })
    }
  }
  if (candidates.length === 0) return []
  candidates.sort((a, b) => b.len - a.len)
  return [candidates[0].key]
}

const ROLE_LABEL: Record<string, string> = {
  handler: '承辦人',
  team_lead: '組長',
  dept_manager: '部門主管',
  vp: '執行副總',
  admin_staff: '行政人員',
  sysadmin: '系統管理員',
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const fromKey = searchParams.get('from') // [2026/06/18] - Lisa - 來源模組 key（含 reviews / settlements 等）
  const { session, logout, switchRole, stopImpersonate } = useAuth()
  // FR-74：收折狀態從 localStorage 還原。SSR 階段 window 不存在，先預設 false，
  // 於 useEffect 內讀取，避免 hydration 不一致。
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [openKeys, setOpenKeys] = useState(MENU_GROUPS.map((g) => g.key))

  // FR-38 / FR-54：導覽 badge 計數
  const [dispatchCount, setDispatchCount] = useState(0)
  const [myCaseCount, setMyCaseCount] = useState(0)
  const [reviewCount, setReviewCount] = useState(0)
  // 通知鈴鐺未讀數
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // FR-74：掛載時還原收折偏好
  useEffect(() => {
    if (localStorage.getItem(SIDER_COLLAPSED_KEY) === '1') setCollapsed(true)
  }, [])

  useEffect(() => {
    if (isMobile) setDrawerOpen(false)
  }, [pathname, isMobile])

  // FR-38 / FR-54 / FR-84：一趟取得 badge 計數 + 未讀通知數（合併端點，減少跨區往返）
  const refetchBadges = useCallback(async () => {
    const res = await api.get<{ dispatchCount: number; myCaseCount: number; reviewCount: number; unreadCount: number }>(
      '/api/badge-counts',
    )
    if (res.success && res.data) {
      setDispatchCount(res.data.dispatchCount)
      setMyCaseCount(res.data.myCaseCount)
      setReviewCount(res.data.reviewCount)
      setUnreadCount(res.data.unreadCount)
    }
  }, [])

  // 計數更新時機：掛載 / 角色切換、案件異動事件、定時輪詢。
  // 不再綁定 pathname —— 換頁本身不會改變計數，每次換頁重打會疊加遠端 DB 往返延遲（每趟約 200ms）。
  useEffect(() => {
    if (!session) return
    refetchBadges()
    const handler = () => refetchBadges()
    window.addEventListener('nansan:case-updated', handler)
    const timer = window.setInterval(refetchBadges, 60_000)
    return () => {
      window.removeEventListener('nansan:case-updated', handler)
      window.clearInterval(timer)
    }
  }, [session, refetchBadges])

  if (!session) return null

  const permissions = getMenuPermissions(session.role)
  const menuItems = buildMenuItems(permissions, dispatchCount, myCaseCount, reviewCount)
  const selectedKeys = getSelectedKeys(pathname, fromKey)
  const siderWidth = collapsed ? 56 : 220

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c
      localStorage.setItem(SIDER_COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }

  function handleMenuClick({ key }: { key: string }) {
    router.push(findPath(key))
  }

  const siderContent = (
    <>
      <div style={{
        height: 64, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
      }}>
        {collapsed && !isMobile ? (
          <Text style={{ color: '#fff', fontWeight: 700, fontSize: 18, textAlign: 'center', letterSpacing: 1 }}>南</Text>
        ) : (
          <>
            <Text style={{ color: '#fff', fontWeight: 700, fontSize: 16, lineHeight: 1.3 }}>南山公證</Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>案件管理系統</Text>
          </>
        )}
      </div>
      <div style={{ height: 'calc(100% - 64px)', overflowY: 'auto', overflowX: 'hidden' }}>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={selectedKeys}
          openKeys={collapsed && !isMobile ? [] : openKeys}
          onOpenChange={setOpenKeys}
          onClick={handleMenuClick}
          items={menuItems}
          inlineIndent={12}
          style={{ borderRight: 0, marginTop: 8, fontSize: 12 }}
        />
      </div>
    </>
  )

  const userMenuItems = [
    { key: 'logout', icon: <LogoutOutlined />, label: '登出', onClick: logout },
  ]

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!isMobile && (
        <Sider
          width={220} collapsedWidth={56} collapsed={collapsed} trigger={null} theme="dark"
          style={{ position: 'fixed', height: '100vh', left: 0, top: 0, bottom: 0, zIndex: 100 }}
        >
          {siderContent}
        </Sider>
      )}

      {isMobile && (
        <Drawer
          open={drawerOpen} onClose={() => setDrawerOpen(false)}
          placement="left" width={220} closable={false} title={null}
          styles={{ body: { padding: 0, background: '#1B4F8C', height: '100%' } }}
        >
          {siderContent}
        </Drawer>
      )}

      <Layout style={{ marginLeft: isMobile ? 0 : siderWidth, transition: 'margin-left 0.2s' }}>
        <Header style={{
          background: '#fff', padding: '0 16px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, zIndex: 99,
        }}>
          <Button
            type="text"
            icon={isMobile ? <MenuUnfoldOutlined /> : collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => isMobile ? setDrawerOpen((d) => !d) : toggleCollapsed()}
            style={{ fontSize: 16, color: '#1A202C', width: 40, height: 40 }}
          />
          <Space size={12}>
            <Badge count={unreadCount} size="small">
              <BellOutlined
                style={{ fontSize: 18, cursor: 'pointer', color: '#1A202C' }}
                onClick={() => router.push('/notifications')}
              />
            </Badge>

            {session.allRoles.length > 1 && !isMobile && (
              <Space size={4}>
                <SwapOutlined style={{ color: '#2E86C1' }} />
                <Select
                  size="small"
                  value={session.allRoles.findIndex((r) => r.role === session.role && r.departmentId === session.departmentId)}
                  onChange={switchRole}
                  style={{ width: 180 }}
                  options={session.allRoles.map((r, i) => ({
                    value: i,
                    label: `${r.roleName}${r.departmentName ? `（${r.departmentName}）` : ''}`,
                  }))}
                />
              </Space>
            )}

            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size="small" icon={<UserOutlined />} style={{ backgroundColor: '#1B4F8C' }} />
                {!isMobile && <span style={{ fontSize: 14 }}>{session.name}</span>}
                {!isMobile && (
                  <span style={{ fontSize: 12, background: '#EBF4FC', color: '#1B4F8C', padding: '2px 8px', borderRadius: 10 }}>
                    {ROLE_LABEL[session.role] ?? session.role}
                  </span>
                )}
              </Space>
            </Dropdown>
          </Space>
        </Header>

        {session.impersonatedBy && (
          <Alert
            type="warning"
            banner
            showIcon
            message={
              <span>
                您正以 <b>{session.name}</b> 身分代理登入（原管理員：{session.impersonatedBy.name}）
              </span>
            }
            action={
              <Button size="small" type="link" onClick={stopImpersonate}>結束代理</Button>
            }
            style={{ position: 'sticky', top: 64, zIndex: 98 }}
          />
        )}
        <Content style={{ background: '#F5F7FA', minHeight: 'calc(100vh - 64px)' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}
