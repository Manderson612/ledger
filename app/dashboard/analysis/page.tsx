'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Legend
} from 'recharts'

interface MonthData {
  month: string
  income: number
  spend: number
  savings: number
}

interface CategoryData {
  name: string
  amount: number
  color: string
  pct: number
}

interface DayData {
  day: string
  amount: number
}

export default function AnalysisPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [monthlyData, setMonthlyData] = useState<MonthData[]>([])
  const [categoryData, setCategoryData] = useState<CategoryData[]>([])
  const [dailyData, setDailyData] = useState<DayData[]>([])
  const [topMerchants, setTopMerchants] = useState<{ name: string; amount: number; count: number }[]>([])
  const [avgDaily, setAvgDaily] = useState(0)
  const [savingsRate, setSavingsRate] = useState(0)
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'))

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const sixMonthsAgo = format(subMonths(startOfMonth(new Date()), 5), 'yyyy-MM-dd')
    const today = format(new Date(), 'yyyy-MM-dd')

    const { data: txns } = await supabase
      .from('transactions')
      .select('*, category:categories(name,color)')
      .eq('user_id', user.id)
      .gte('date', sixMonthsAgo)
      .lte('date', today)
      .order('date')

    if (!txns) { setLoading(false); return }

    // Monthly income/spend/savings
    const byMonth: Record<string, { income: number; spend: number }> = {}
    for (let i = 5; i >= 0; i--) {
      const m = format(subMonths(new Date(), i), 'yyyy-MM')
      byMonth[m] = { income: 0, spend: 0 }
    }
    for (const t of txns) {
      const m = t.date.slice(0, 7)
      if (!byMonth[m]) continue
      if (t.type === 'income') byMonth[m].income += t.amount
      else if (t.type === 'expense') byMonth[m].spend += t.amount
    }
    const monthly: MonthData[] = Object.entries(byMonth).map(([m, v]) => ({
      month: format(new Date(m + '-01'), 'MMM yy'),
      income: Math.round(v.income),
      spend: Math.round(v.spend),
      savings: Math.round(v.income - v.spend),
    }))
    setMonthlyData(monthly)

    // Current month savings rate
    const currentM = format(new Date(), 'yyyy-MM')
    const cm = byMonth[currentM]
    if (cm && cm.income > 0) setSavingsRate(Math.round(((cm.income - cm.spend) / cm.income) * 100))

    // Category breakdown for selected month
    const selStart = selectedMonth + '-01'
    const selEnd = format(endOfMonth(new Date(selStart)), 'yyyy-MM-dd')
    const selTxns = txns.filter(t => t.date >= selStart && t.date <= selEnd && t.type === 'expense')
    const byCat: Record<string, { amount: number; color: string }> = {}
    for (const t of selTxns) {
      const name = (t.category as any)?.name || 'Uncategorized'
      const color = (t.category as any)?.color || '#888'
      if (!byCat[name]) byCat[name] = { amount: 0, color }
      byCat[name].amount += t.amount
    }
    const totalSpend = Object.values(byCat).reduce((s, v) => s + v.amount, 0)
    const cats: CategoryData[] = Object.entries(byCat)
      .map(([name, v]) => ({ name, amount: Math.round(v.amount), color: v.color, pct: Math.round((v.amount / totalSpend) * 100) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8)
    setCategoryData(cats)

    // Daily spend for selected month
    const dayMap: Record<string, number> = {}
    for (const t of selTxns) {
      const d = format(new Date(t.date), 'MMM d')
      dayMap[d] = (dayMap[d] || 0) + t.amount
    }
    const days: DayData[] = Object.entries(dayMap).map(([day, amount]) => ({ day, amount: Math.round(amount) }))
    setDailyData(days)
    const avgD = days.length > 0 ? Math.round(days.reduce((s, d) => s + d.amount, 0) / days.length) : 0
    setAvgDaily(avgD)

    // Top merchants for selected month
    const merchantMap: Record<string, { amount: number; count: number }> = {}
    for (const t of selTxns) {
      if (!merchantMap[t.description]) merchantMap[t.description] = { amount: 0, count: 0 }
      merchantMap[t.description].amount += t.amount
      merchantMap[t.description].count++
    }
    const merchants = Object.entries(merchantMap)
      .map(([name, v]) => ({ name, amount: Math.round(v.amount), count: v.count }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8)
    setTopMerchants(merchants)

    setLoading(false)
  }, [supabase, selectedMonth])

  useEffect(() => { load() }, [load])

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(new Date(), 5 - i)
    return { value: format(d, 'yyyy-MM'), label: format(d, 'MMM yyyy') }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Spend Analysis</h1>
          <p className="text-sm text-gray-500 mt-0.5">Trends, patterns, and insights from your spending</p>
        </div>
        <select className="input w-auto" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
          {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Avg daily spend', value: formatCurrency(avgDaily) },
          { label: 'Savings rate', value: `${savingsRate}%` },
          { label: 'Top category', value: categoryData[0]?.name || '—' },
          { label: 'Top merchant', value: topMerchants[0]?.name?.slice(0, 18) || '—' },
        ].map(m => (
          <div key={m.label} className="metric-card">
            <p className="text-xs text-gray-500 mb-1">{m.label}</p>
            <p className="text-sm font-semibold text-gray-900 truncate">{m.value}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
      ) : (
        <>
          {/* Income vs Spend vs Savings - 6 months */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-4">Income vs Spend — Last 6 Months</h2>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData} barGap={4}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Legend />
                  <Bar dataKey="income" name="Income" fill="#1D9E75" radius={[3,3,0,0]} />
                  <Bar dataKey="spend" name="Spend" fill="#378ADD" radius={[3,3,0,0]} />
                  <Bar dataKey="savings" name="Savings" fill="#EF9F27" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Category breakdown */}
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-4">Spend by Category</h2>
              {categoryData.length === 0 ? (
                <p className="text-sm text-gray-400">No expense data for this month</p>
              ) : (
                <>
                  <div className="h-40 mb-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={categoryData} dataKey="amount" nameKey="name" cx="50%" cy="50%" outerRadius={60} innerRadius={30}>
                          {categoryData.map((c, i) => <Cell key={i} fill={c.color} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2">
                    {categoryData.map(c => (
                      <div key={c.name}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                            {c.name}
                          </span>
                          <span className="text-gray-500">{formatCurrency(c.amount)} · {c.pct}%</span>
                        </div>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${c.pct}%`, background: c.color }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Top merchants */}
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-4">Top Merchants</h2>
              {topMerchants.length === 0 ? (
                <p className="text-sm text-gray-400">No data for this month</p>
              ) : (
                <div className="space-y-2">
                  {topMerchants.map((m, i) => (
                    <div key={m.name} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-gray-400 w-4">{i + 1}</span>
                        <div>
                          <p className="text-sm font-medium text-gray-800 truncate max-w-[180px]">{m.name}</p>
                          <p className="text-xs text-gray-400">{m.count} transaction{m.count > 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-gray-800">{formatCurrency(m.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Daily spend */}
          {dailyData.length > 0 && (
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-4">Daily Spend — {months.find(m => m.value === selectedMonth)?.label}</h2>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} interval={2} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v}`} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Bar dataKey="amount" name="Spend" fill="#378ADD" radius={[2,2,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}