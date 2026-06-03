'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Card, Table, Typography, Spin,
} from 'antd'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { api } from '@/lib/api'

const { Title } = Typography

interface YearlyFeeStats {
  year: number
  totalFee: number
}

export default function FeeYearlyReportPage() {
  const [stats, setStats] = useState<YearlyFeeStats[]>([])
  const [loading, setLoading] = useState(false)

  const loadStats = useCallback(async () => {
    setLoading(true)
    const currentYear = new Date().getFullYear()
    const results: YearlyFeeStats[] = []

    for (let y = currentYear - 4; y <= currentYear; y++) {
      const res = await api.get<{ monthlyStats: { fee: number }[] }>(`/api/reports?year=${y}`)
      if (res.success && res.data) {
        const totalFee = res.data.monthlyStats.reduce((s, m) => s + m.fee, 0)
        results.push({ year: y, totalFee })
      }
    }
    setStats(results)
    setLoading(false)
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin /></div>

  const columns = [
    { title: '年度', dataIndex: 'year', key: 'year' },
    {
      title: '公證費合計',
      dataIndex: 'totalFee',
      key: 'totalFee',
      align: 'right' as const,
      render: (v: number) => v.toLocaleString(),
    },
  ]

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} style={{ marginBottom: 16 }}>各年度公證費統計</Title>
      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={stats} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="year" />
            <YAxis tickFormatter={(v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : String(v)} />
            <Tooltip formatter={(v) => [Number(v).toLocaleString(), '公證費']} />
            <Bar dataKey="totalFee" name="公證費" fill="#2E86C1" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card bordered={false} style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <Table dataSource={stats} columns={columns} rowKey="year" size="small" pagination={false} />
      </Card>
    </div>
  )
}
