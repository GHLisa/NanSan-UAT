import type { Metadata } from 'next'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import { ConfigProvider } from 'antd'
import zhTW from 'antd/locale/zh_TW'
import './globals.css'

export const metadata: Metadata = {
  title: '南山公證 案件管理系統',
  description: '南山公證股份有限公司 案件管理系統',
}

const theme = {
  token: {
    colorPrimary: '#1B4F8C',
    colorLink: '#2E86C1',
    colorBgLayout: '#F5F7FA',
    colorTextBase: '#1A202C',
    borderRadius: 6,
    fontFamily: "'Noto Sans TC', 'Microsoft JhengHei', sans-serif",
  },
  components: {
    Menu: {
      darkItemBg: '#1B4F8C',
      darkSubMenuItemBg: '#163f70',
      darkItemSelectedBg: '#2E86C1',
    },
    Layout: {
      siderBg: '#1B4F8C',
      headerBg: '#ffffff',
    },
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body style={{ margin: 0, fontFamily: "'Noto Sans TC', 'Microsoft JhengHei', sans-serif" }}>
        <AntdRegistry>
          <ConfigProvider locale={zhTW} theme={theme}>
            {children}
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  )
}
