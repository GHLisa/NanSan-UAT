import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { AuthProvider } from '@/components/layout/AuthProvider'
import AppLayout from '@/components/layout/AppLayout'

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <AuthProvider initialSession={session}>
      <AppLayout>{children}</AppLayout>
    </AuthProvider>
  )
}
