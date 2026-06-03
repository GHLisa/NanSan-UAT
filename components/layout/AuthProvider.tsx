'use client'

import { createContext, useContext, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { message } from 'antd'
import { api } from '@/lib/api'
import type { JWTPayload } from '@/types'

interface AuthContextType {
  session: JWTPayload | null
  loading: boolean
  logout: () => Promise<void>
  switchRole: (roleIndex: number) => Promise<void>
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export function AuthProvider({ children, initialSession }: {
  children: React.ReactNode
  initialSession: JWTPayload
}) {
  const router = useRouter()
  const [session, setSession] = useState<JWTPayload | null>(initialSession)
  const [loading, setLoading] = useState(false)

  const refreshSession = useCallback(async () => {
    const res = await api.get<JWTPayload>('/api/auth/me')
    if (res.success && res.data) setSession(res.data)
  }, [])

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout', {})
    router.push('/login')
  }, [router])

  const switchRole = useCallback(async (roleIndex: number) => {
    setLoading(true)
    const res = await api.post<{ roleName: string; departmentName: string | null }>(
      '/api/auth/switch-role', { roleIndex }
    )
    setLoading(false)
    if (!res.success) {
      message.error('角色切換失敗')
      return
    }
    await refreshSession()
    message.success(`已切換為 ${res.data?.roleName}`)
    router.push('/dashboard')
    router.refresh()
  }, [refreshSession, router])

  return (
    <AuthContext.Provider value={{ session, loading, logout, switchRole, refreshSession }}>
      {children}
    </AuthContext.Provider>
  )
}
