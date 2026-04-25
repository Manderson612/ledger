'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { FileBarChart, Sparkles, Download, CheckCircle, AlertCircle, X } from 'lucide-react'

interface Toast { message: string; type: 'success' | 'error' }
interface ReportData {
  month: string
  totalIncome: number
  totalExpenses: number
  netSavings: number
  savingsRate: number
  topCategories: { name: string; amount: number }[]
  totalBills: number
  transactionCount: number
}

function ToastBanner({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
      {toast.message}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
    </div>
  )
}

export default function ReportsPage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [aiSummary, setAiSummary] = useState('')
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [toast, setToast] = useState<Toast | null>(null)

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(new Date(), i)
    return { value: format(d, 'yyyy-MM'), label: format(d, 'MMMM yyyy') }
  })

  const load = useCallback(async () => {
    setLoading(true)
    setAiSummary('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const monthStart = selectedMonth + '-01'
    const monthEnd = format(endOfMonth(new Date(monthStart)), 'yyyy-MM-dd')

    const [{ data: txns }, { data: bills }, { data: cats }] = await Promise.all([
      supabase.from('transactions').select('*, category:categories(name,color)')
        .eq('user_id', user.id).gte('date', monthStart).lte('date', monthEnd),
      supabase.from('bills').select('*').eq('user_id', user.id).eq('is_active', true),
      supabase.from('categories').select('*').eq('user_id', user.id),
    ])

    const income = (txns || []).filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
    const expenses = (txns || []).filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
    const savings = income - expenses
    const savingsRate = income > 0 ? Math.round((savings / income) * 100) : 0

    const byCat: Record<string, number> = {}
    for (const t of (txns || []).filter(t => t.type === 'expense')) {
      const name = (t.category as any)?.name || 'Uncategorized'
      byCat[name] = (byCat[name] || 0) + t.amount
    }
    const topCategories = Object.entries(byCat)
      .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)

    setReportData({
      month: format(new Date(monthStart), 'MMMM yyyy'),
      totalIncome: Math.round(income),
      totalExpenses: Math.round(expenses),
      netSavings: Math.round(savings),
      savingsRate,
      topCategories,
      totalBills: (bills || []).reduce((s, b) => s + b.amount, 0),
      transactionCount: (txns || []).length,
    })

    setLoading(false)
  }, [supabase, selectedMonth])

  useEffect(() => { load() }, [load])

  async function generateAISummary() {
    if (!reportData) return
    setGenerating(true)
    try {
      const response = await fetch('/api/monthly-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportData }),
      })
      const { summary } = await response.json()
      setAiSummary(summary)
    } catch {
      showToast('Could not generate summary', 'error')
    }
    setGenerating(false)
  }

  function exportCSV() {
    if (!reportData) return
    const rows = [
      ['Ledger Monthly Report', reportData.month],
      [],
      ['Metric', 'Amount'],
      ['Total Income', reportData.totalIncome],
      ['Total Expenses', reportData.totalExpenses],
      ['Net Savings', reportData.netSavings],
      ['Savings Rate', `${reportData.savingsRate}%`],
      ['Total Bills', reportData.totalBills],
      ['Transactions', reportData.transactionCount],
      [],
      ['Category', 'Amount'],
      ...reportData.topCategories.map(c => [c.name, c.amount]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ledger-${selectedMonth}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showToast('Report downloaded')
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Monthly summaries and AI insights</p>
        </div>
        <div className="flex gap-2 items-center">
          <select className="input w-auto" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}>
            {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <button className="btn-secondary" onClick={exportCSV}><Download className="w-4 h-4" />Export CSV</button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
      ) : reportData ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Income', value: formatCurrency(reportData.totalIncome), color: 'text-emerald-600' },
              { label: 'Expenses', value: formatCurrency(reportData.totalExpenses), color: 'text-gray-900' },
              { label: 'Net savings', value: formatCurrency(reportData.netSavings), color: reportData.netSavings >= 0 ? 'text-emerald-600' : 'text-red-500' },
              { label: 'Savings rate', value: `${reportData.savingsRate}%`, color: reportData.savingsRate >= 20 ? 'text-emerald-600' : 'text-amber-500' },
            ].map(m => (
              <div key={m.label} className="metric-card">
                <p className="text-xs text-gray-500 mb-1">{m.label}</p>
                <p className={`text-xl font-semibold ${m.color}`}>{m.value}</p>
              </div>
            ))}
          </div>

          {/* Top categories */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-4">Top Spending Categories — {reportData.month}</h2>
            {reportData.topCategories.length === 0 ? (
              <p className="text-sm text-gray-400">No expense data for this month</p>
            ) : (
              <div className="space-y-3">
                {reportData.topCategories.map(c => {
                  const pct = reportData.totalExpenses > 0 ? Math.round((c.amount / reportData.totalExpenses) * 100) : 0
                  return (
                    <div key={c.name}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-800">{c.name}</span>
                        <span className="text-gray-500">{formatCurrency(c.amount)} · {pct}%</span>
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill bg-brand-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Additional stats */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-4">Additional Stats</h2>
            <div className="space-y-0">
              {[
                { label: 'Total transactions', value: String(reportData.transactionCount) },
                { label: 'Monthly fixed bills', value: formatCurrency(reportData.totalBills) },
                { label: 'Avg daily spend', value: formatCurrency(Math.round(reportData.totalExpenses / 30)) },
                { label: 'Discretionary spend', value: formatCurrency(Math.max(0, reportData.totalExpenses - reportData.totalBills)) },
              ].map(s => (
                <div key={s.label} className="data-row">
                  <span className="text-gray-600">{s.label}</span>
                  <span className="font-semibold text-gray-900">{s.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* AI Summary */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900">AI Monthly Summary</h2>
              <button className="btn-secondary text-xs" onClick={generateAISummary} disabled={generating}>
                <Sparkles className="w-3.5 h-3.5" />{generating ? 'Generating...' : 'Generate'}
              </button>
            </div>
            {aiSummary ? (
              <p className="text-sm text-gray-700 leading-relaxed">{aiSummary}</p>
            ) : (
              <div className="text-center py-6">
                <FileBarChart className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">Click Generate for an AI summary of your {reportData.month} finances</p>
              </div>
            )}
          </div>
        </>
      ) : null}

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}