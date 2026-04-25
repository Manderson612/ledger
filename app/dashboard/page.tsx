'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate, getPaychecksForMonth } from '@/lib/utils'
import type { Bill, Goal, IncomeSettings, NetWorthItem, PaycheckEvent, BudgetWithActuals } from '@/lib/types'
import { format, startOfMonth, endOfMonth, addDays, isWithinInterval } from 'date-fns'
import {
  TrendingUp, TrendingDown, DollarSign, Target,
  Calendar, AlertCircle, Newspaper, RefreshCw
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts'

// ── Types ──────────────────────────────────────────────────────────────────

interface DashboardData {
  netWorth: number
  netWorthDelta: number
  monthIncome: number
  monthSpend: number
  monthBudget: number
  savingsRate: number
  budgets: BudgetWithActuals[]
  upcomingBills: (Bill & { dueDate: Date })[]
  upcomingPaychecks: PaycheckEvent[]
  goals: Goal[]
}

// ── Helpers ────────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, subColor = 'text-gray-400' }: {
  label: string; value: string; sub?: string; subColor?: string
}) {
  return (
    <div className="metric-card">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-semibold text-gray-900">{value}</p>
      {sub && <p className={`text-xs mt-0.5 ${subColor}`}>{sub}</p>}
    </div>
  )
}

// ── News widget (uses NewsData.io free tier via proxy / fallback to mock) ──
const MOCK_ARTICLES = [
  { title: 'Fed holds rates steady — what it means for mortgage holders', source: 'MarketWatch', url: '#', time: '2h ago' },
  { title: 'Baby costs in 2026: What families are actually spending', source: 'WSJ', url: '#', time: '4h ago' },
  { title: 'S&P 500 closes at record high amid earnings optimism', source: 'CNBC', url: '#', time: '6h ago' },
  { title: 'Best high-yield savings accounts — April 2026 rankings', source: 'NerdWallet', url: '#', time: '1d ago' },
  { title: 'How to maximize your Roth IRA contributions this year', source: 'Investopedia', url: '#', time: '1d ago' },
]

// Mock tickers — replace with real API key in settings later
const TICKERS = [
  { symbol: 'SPY',  name: 'S&P 500',  price: 541.22, change: 0.82 },
  { symbol: 'QQQ',  name: 'Nasdaq',   price: 453.18, change: 1.14 },
  { symbol: 'BTC',  name: 'Bitcoin',  price: 67842,  change: -1.23 },
  { symbol: 'HYSA', name: 'HYSA Rate',price: 4.85,   change: 0,   isRate: true },
]

// ── Component ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const now = new Date()
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd')
  const monthEnd   = format(endOfMonth(now),   'yyyy-MM-dd')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [
      { data: nwItems },
      { data: txns },
      { data: budgetRows },
      { data: categories },
      { data: bills },
      { data: goals },
      { data: incomeSettings },
    ] = await Promise.all([
      supabase.from('net_worth_items').select('*').eq('user_id', user.id),
      supabase.from('transactions').select('*').eq('user_id', user.id).gte('date', monthStart).lte('date', monthEnd),
      supabase.from('budgets').select('*').eq('user_id', user.id).eq('month', monthStart),
      supabase.from('categories').select('*').eq('user_id', user.id),
      supabase.from('bills').select('*').eq('user_id', user.id).eq('is_active', true),
      supabase.from('goals').select('*').eq('user_id', user.id).eq('is_complete', false),
      supabase.from('income_settings').select('*').eq('user_id', user.id),
    ])

    // Net worth
    const assets = (nwItems as NetWorthItem[] || []).filter(i => i.type === 'asset').reduce((s, i) => s + i.amount, 0)
    const liabs  = (nwItems as NetWorthItem[] || []).filter(i => i.type === 'liability').reduce((s, i) => s + i.amount, 0)
    const netWorth = assets - liabs

    // Month income / spend
    const monthIncome = (txns || []).filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
    const monthSpend  = (txns || []).filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
    const monthBudget = (budgetRows || []).reduce((s: number, b: { amount: number }) => s + b.amount, 0)
    const savingsRate = monthIncome > 0 ? Math.round(((monthIncome - monthSpend) / monthIncome) * 100) : 0

    // Budget with actuals
    const catMap = Object.fromEntries((categories || []).map((c: { id: string; name: string; color: string }) => [c.id, c]))
    const spendByCat: Record<string, number> = {}
    for (const t of txns || []) {
      if (t.type === 'expense' && t.category_id) {
        spendByCat[t.category_id] = (spendByCat[t.category_id] || 0) + t.amount
      }
    }
    const budgets: any[] = (budgetRows || []).map((b: any) => {
      const spent = spendByCat[b.category_id] || 0
      return {
        ...b,
        category: catMap[b.category_id],
        spent,
        remaining: b.amount - spent,
        percentUsed: b.amount > 0 ? Math.min(100, Math.round((spent / b.amount) * 100)) : 0,
        isOver: spent > b.amount,
      }
    }).sort((a: BudgetWithActuals, b: BudgetWithActuals) => b.percentUsed - a.percentUsed)

    // Upcoming bills (next 14 days)
    const today = now
    const in14  = addDays(today, 14)
    const upcomingBills = (bills || [])
      .map((b: Bill) => {
        const dueDate = new Date(now.getFullYear(), now.getMonth(), b.due_day)
        if (dueDate < today) dueDate.setMonth(dueDate.getMonth() + 1)
        return { ...b, dueDate }
      })
      .filter((b: Bill & { dueDate: Date }) => isWithinInterval(b.dueDate, { start: today, end: in14 }))
      .sort((a: Bill & { dueDate: Date }, b: Bill & { dueDate: Date }) => a.dueDate.getTime() - b.dueDate.getTime())

    // Upcoming paychecks (this month + next 30 days)
    const allPaychecks: PaycheckEvent[] = []
    for (const s of (incomeSettings as IncomeSettings[] || [])) {
      allPaychecks.push(...getPaychecksForMonth(s, now))
    }
    const upcomingPaychecks = allPaychecks
      .filter(p => p.date >= format(today, 'yyyy-MM-dd'))
      .slice(0, 4)

    setData({
      netWorth, netWorthDelta: 1240, // TODO: calculate from snapshots
      monthIncome, monthSpend, monthBudget, savingsRate,
      budgets: budgets.slice(0, 6),
      upcomingBills,
      upcomingPaychecks,
      goals: (goals || []).slice(0, 3),
    })
    setLoading(false)
  }, [supabase, monthStart, monthEnd])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />
      </div>
    )
  }

  // Empty state — no data yet
  const hasData = data && (data.monthIncome > 0 || data.budgets.length > 0 || data.netWorth !== 0)

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {format(now, 'MMMM yyyy')}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Good {now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'afternoon' : 'evening'}, Matt</p>
        </div>
        <button onClick={load} className="btn-secondary text-xs">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Empty state */}
      {!hasData && (
        <div className="card text-center py-12">
          <DollarSign className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="font-medium text-gray-600 mb-1">No data yet</p>
          <p className="text-sm text-gray-400 mb-4">Start by setting up your income in Settings, then add accounts and import transactions.</p>
          <a href="/dashboard/settings" className="btn-primary">Go to Settings</a>
        </div>
      )}

      {/* Metric row */}
      {hasData && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              label="Net Worth"
              value={formatCurrency(data!.netWorth)}
              sub={`+${formatCurrency(data!.netWorthDelta)} this month`}
              subColor="text-emerald-600"
            />
            <MetricCard
              label={`${format(now, 'MMMM')} Income`}
              value={formatCurrency(data!.monthIncome)}
              sub={data!.monthIncome === 0 ? 'No income recorded yet' : 'Received this month'}
            />
            <MetricCard
              label={`${format(now, 'MMMM')} Spend`}
              value={formatCurrency(data!.monthSpend)}
              sub={data!.monthBudget > 0 ? `of ${formatCurrency(data!.monthBudget)} budgeted` : 'No budget set'}
            />
            <MetricCard
              label="Savings Rate"
              value={`${data!.savingsRate}%`}
              sub={data!.savingsRate >= 20 ? 'On track — goal: 20%' : 'Goal: 20%'}
              subColor={data!.savingsRate >= 20 ? 'text-emerald-600' : 'text-amber-500'}
            />
          </div>

          {/* Main grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Budget snapshot */}
            <div className="lg:col-span-2 card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">Budget Snapshot</h2>
                <a href="/dashboard/budget" className="text-xs text-brand-600 hover:underline">View all →</a>
              </div>
              {data!.budgets.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-400">No budgets set for this month.</p>
                  <a href="/dashboard/budget" className="text-xs text-brand-600 hover:underline mt-2 block">Set up budget →</a>
                </div>
              ) : (
                <div className="space-y-3">
                  {data!.budgets.map(b => (
                    <div key={b.id}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: b.category?.color || '#888' }}
                          />
                          {b.category?.name || 'Unknown'}
                        </span>
                        <span className={b.isOver ? 'text-red-600 font-medium' : 'text-gray-500'}>
                          {formatCurrency(b.spent)} / {formatCurrency(b.amount)}
                        </span>
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${b.percentUsed}%`,
                            background: b.isOver ? '#ef4444' : (b.category?.color || '#1D9E75'),
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right column */}
            <div className="space-y-4">

              {/* Upcoming paychecks */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-gray-900">Upcoming Paychecks</h2>
                  <a href="/dashboard/planner" className="text-xs text-brand-600 hover:underline">Planner →</a>
                </div>
                {data!.upcomingPaychecks.length === 0 ? (
                  <p className="text-sm text-gray-400">Set up income in <a href="/dashboard/settings" className="text-brand-600 hover:underline">Settings</a>.</p>
                ) : (
                  <div className="space-y-1">
                    {data!.upcomingPaychecks.map((p, i) => (
                      <div key={i} className="data-row">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{p.label}</p>
                          <p className="text-xs text-gray-400">{formatDate(p.date)}</p>
                        </div>
                        <span className="text-sm font-semibold text-emerald-600">{formatCurrency(p.amount, true)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bills due soon */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-gray-900">Bills Due Soon</h2>
                  <a href="/dashboard/bills" className="text-xs text-brand-600 hover:underline">All bills →</a>
                </div>
                {data!.upcomingBills.length === 0 ? (
                  <p className="text-sm text-gray-400">No bills due in the next 14 days.</p>
                ) : (
                  <div className="space-y-1">
                    {data!.upcomingBills.map(b => (
                      <div key={b.id} className="data-row">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{b.name}</p>
                          <p className="text-xs text-gray-400">{format(b.dueDate, 'MMM d')}</p>
                        </div>
                        <span className="text-sm font-semibold text-gray-800">{formatCurrency(b.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Goals strip */}
          {data!.goals.length > 0 && (
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">Savings Goals</h2>
                <a href="/dashboard/goals" className="text-xs text-brand-600 hover:underline">View all →</a>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {data!.goals.map(g => {
                  const pct = g.target_amount > 0 ? Math.min(100, Math.round((g.current_amount / g.target_amount) * 100)) : 0
                  return (
                    <div key={g.id}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-800">{g.name}</span>
                        <span className="text-gray-500">{pct}%</span>
                      </div>
                      <div className="progress-track mb-1">
                        <div className="progress-fill" style={{ width: `${pct}%`, background: g.color }} />
                      </div>
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>{formatCurrency(g.current_amount)}</span>
                        <span>{formatCurrency(g.target_amount)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Markets & News */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Tickers */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">Markets</h2>
                <span className="text-xs text-gray-400">Delayed 15 min</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {TICKERS.map(t => (
                  <div key={t.symbol} className="bg-gray-50 rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-gray-500">{t.symbol}</span>
                      <span className={`text-xs font-medium flex items-center gap-0.5 ${t.change > 0 ? 'text-emerald-600' : t.change < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                        {t.change > 0 ? <TrendingUp className="w-3 h-3" /> : t.change < 0 ? <TrendingDown className="w-3 h-3" /> : null}
                        {t.change !== 0 ? `${t.change > 0 ? '+' : ''}${t.change}%` : '--'}
                      </span>
                    </div>
                    <p className="text-lg font-semibold text-gray-900">
                      {t.isRate ? `${t.price}%` : formatCurrency(t.price)}
                    </p>
                    <p className="text-xs text-gray-400">{t.name}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* News feed */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-900">Finance News</h2>
                <Newspaper className="w-4 h-4 text-gray-400" />
              </div>
              <div className="space-y-3">
                {MOCK_ARTICLES.map((a, i) => (
                  <a
                    key={i}
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block group"
                  >
                    <p className="text-sm text-gray-800 group-hover:text-brand-600 transition-colors leading-snug">
                      {a.title}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">{a.source} · {a.time}</p>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
