import Link from 'next/link'

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#F5F7FA',
    }}>
      <div style={{
        width: 64, height: 64, background: '#1B4F8C', borderRadius: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24,
      }}>
        <span style={{ color: '#fff', fontSize: 28, fontWeight: 900 }}>南</span>
      </div>
      <h1 style={{ fontSize: 48, fontWeight: 900, color: '#1B4F8C', margin: 0 }}>404</h1>
      <p style={{ color: '#555', marginBottom: 24 }}>找不到此頁面</p>
      <Link href="/dashboard" style={{
        background: '#1B4F8C', color: '#fff', padding: '8px 24px',
        borderRadius: 6, textDecoration: 'none', fontSize: 14,
      }}>
        返回儀表板
      </Link>
    </div>
  )
}
