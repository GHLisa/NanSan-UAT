'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import {
  Layout, Menu, Avatar, Dropdown, Badge, Typography, Space,
  Select, Button, Drawer,
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

function buildMenuItems(permissions: string[]) {
  const groupLabel = (text: string) => (
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', color: '#7FBAFF', textTransform: 'uppercase' }}>
      {text}
    </span>
  )

  return MENU_GROUPS
    .map((group) => {
      const keyChildren = ALL_MENU_ITEMS
        .filter((item) => (group.keys ?? []).includes(item.key) && permissions.includes(item.key))
        .map((item) => ({ key: item.key, icon: item.icon, label: item.label }))

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

function getSelectedKeys(pathname: string): string[] {
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
  const { session, logout, switchRole } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [openKeys, setOpenKeys] = useState(MENU_GROUPS.map((g) => g.key))

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  useEffect(() => {
    if (isMobile) setDrawerOpen(false)
  }, [pathname, isMobile])

  if (!session) return null

  const permissions = getMenuPermissions(session.role)
  const menuItems = buildMenuItems(permissions)
  const selectedKeys = getSelectedKeys(pathname)
  const siderWidth = collapsed ? 64 : 220

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
          width={220} collapsedWidth={64} collapsed={collapsed} trigger={null} theme="dark"
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
            onClick={() => isMobile ? setDrawerOpen((d) => !d) : setCollapsed((c) => !c)}
            style={{ fontSize: 16, color: '#1A202C', width: 40, height: 40 }}
          />
          <Space size={12}>
            <Badge count={0} size="small">
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

        <Content style={{ background: '#F5F7FA', minHeight: 'calc(100vh - 64px)' }}>
          {children}
        </Content>
      </Layout>
    </Layout>
  )
}
