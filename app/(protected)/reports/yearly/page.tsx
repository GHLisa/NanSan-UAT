'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Card, Table, Typography, Spin,
} from 'antd'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { api } from '@/lib/api'

const { Title } = Typography

interface YearlyStats {
  year: number
  pending: number
  closed: number
  cancelled: number
  total: number
}

export default function YearlyReportPage() {
  const [stats, setStats] = useState<YearlyStats[]>([])
  const [loading, setLoading] = useState(false)

  const loadStats = useCallback(async () => {
    setLoading(true)
    const currentYear = new Date().getFullYear()
    const results: YearlyStats[] = []

    for (let y = currentYear - 4; y <= currentYear; y++) {
      const res = await api.get<{ monthlyStats: { count: number }[]; employeePerformance: unknown[] }>(
        `/api/reports?year=${y}`
      )
      if (res.success && res.data) {
        const total = res.data.monthlyStats.reduce((s, m) => s + m.count, 0)
        results.push({ year: y, pending: 0, closed: total, cancelled: 0, total })
      }
    }
    setStats(results)
    setLoading(false)
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin /></div>

  const columns = [
    { title: '年度', dataIndex: 'year', key: 'year' },
    { title: '已決', dataIndex: 'closed', key: 'closed', align: 'right' as const },
    { title: '合計', dataIndex: 'total', key: 'total', align: 'right' as const },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 16 }}>各年度案件數統計</Title>
      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={stats} margin={{ top: 8, right: 16, left: -16, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="year" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="closed" name="已決" fill="#1B4F8C" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Table dataSource={stats} columns={columns} rowKey="year" size="small" pagination={false} />
      </Card>
    </div>
  )
}
