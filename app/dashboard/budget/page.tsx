'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import type { Category } from '@/lib/types'
import { Plus, Save, CheckCircle, AlertCircle, X, Sparkles } from 'lucide-react'
import { format, startOfMonth } from 'date-fns'

interface Toast { message: string; type: 'success' | 'error' }
interface BudgetRow {
  id?: string
  category_id: string
  category_name: string
  category_color: string
  budgeted: number
  spent: number
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

export default function BudgetPage() {
  const supabase = createClient()
  const [budgets, setBudgets] = useState<BudgetRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()))
  const [editValues, setEditValues] = useState<Record<string, string>>({})

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const monthStr = format(currentMonth, 'yyyy-MM-dd')
    const monthStart = monthStr
    const monthEnd = format(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0), 'yyyy-MM-dd')

    const [{ data: cats }, { data: budgetRows }, { data: txns }] = await Promise.all([
      supabase.from('categories').select('*').eq('user_id', user.id).eq('is_income', false).order('name'),
      supabase.from('budgets').select('*').eq('user_id', user.id).eq('month', monthStr),
      supabase.from('transactions').select('category_id, amount').eq('user_id', user.id).eq('type', 'expense').gte('date', monthStart).lte('date', monthEnd),
    ])

    const spendByCat: Record<string, number> = {}
    for (const t of txns || []) {
      if (t.category_id) spendByCat[t.category_id] = (spendByCat[t.category_id] || 0) + t.amount
    }

    const budgetMap: Record<string, { id: string; amount: number }> = {}
    for (const b of budgetRows || []) {
      budgetMap[b.category_id] = { id: b.id, amount: b.amount }
    }

    const rows: BudgetRow[] = (cats || []).map(c => ({
      id: budgetMap[c.id]?.id,
      category_id: c.id,
      category_name: c.name,
      category_color: c.color,
      budgeted: budgetMap[c.id]?.amount || 0,
      spent: spendByCat[c.id] || 0,
    }))

    setBudgets(rows)
    setCategories(cats || [])
    const vals: Record<string, string> = {}
    rows.forEach(r => { vals[r.category_id] = r.budgeted > 0 ? String(r.budgeted) : '' })
    setEditValues(vals)
    setLoading(false)
  }, [supabase, currentMonth])

  useEffect(() => { load() }, [load])

  async function saveAll() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const monthStr = format(currentMonth, 'yyyy-MM-dd')
    const toUpsert = budgets
      .filter(b => editValues[b.category_id] && Number(editValues[b.category_id]) > 0)
      .map(b => ({
        user_id: user.id,
        category_id: b.category_id,
        month: monthStr,
        amount: Number(editValues[b.category_id]),
      }))

    const { error } = await supabase.from('budgets').upsert(toUpsert, { onConflict: 'user_id,category_id,month' })
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Budget saved')
    load()
  }

  async function getSuggestions() {
    setSuggesting(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Get last 3 months of spending
    const threeMonthsAgo = format(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 3, 1), 'yyyy-MM-dd')
    const { data: txns } = await supabase.from('transactions').select('category_id, amount')
      .eq('user_id', user.id).eq('type', 'expense').gte('date', threeMonthsAgo)

    const spendByCat: Record<string, number[]> = {}
    for (const t of txns || []) {
      if (t.category_id) {
        if (!spendByCat[t.category_id]) spendByCat[t.category_id] = []
        spendByCat[t.category_id].push(t.amount)
      }
    }

    const spendingData = budgets.map(b => ({
      category: b.category_name,
      avg_monthly: spendByCat[b.category_id]
        ? Math.round(spendByCat[b.category_id].reduce((s, x) => s + x, 0) / 3)
        : 0
    }))

    try {
      const response = await fetch('/api/budget-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spending: spendingData }),
      })
      const { suggestions } = await response.json()
      if (suggestions) {
        const newVals = { ...editValues }
        for (const s of suggestions) {
          const match = budgets.find(b => b.category_name === s.category)
          if (match) newVals[match.category_id] = String(s.suggested_budget)
        }
        setEditValues(newVals)
        showToast('AI suggestions applied — review and save')
      }
    } catch {
      showToast('Could not get suggestions', 'error')
    }
    setSuggesting(false)
  }

  const totalBudgeted = Object.values(editValues).reduce((s, v) => s + (Number(v) || 0), 0)
  const totalSpent = budgets.reduce((s, b) => s + b.spent, 0)
  const overCount = budgets.filter(b => b.spent > (Number(editValues[b.category_id]) || 0) && b.spent > 0).length

  const prevMonth = () => setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))
  const nextMonth = () => setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Budget</h1>
          <p className="text-sm text-gray-500 mt-0.5">Set monthly limits and track actual spending</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="btn-secondary px-2.5">‹</button>
          <span className="text-sm font-medium text-gray-700 min-w-[110px] text-center">{format(currentMonth, 'MMMM yyyy')}</span>
          <button onClick={nextMonth} className="btn-secondary px-2.5">›</button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total budgeted', value: formatCurrency(totalBudgeted), color: 'text-gray-900' },
          { label: 'Total spent', value: formatCurrency(totalSpent), color: 'text-gray-900' },
          { label: 'Remaining', value: formatCurrency(totalBudgeted - totalSpent), color: totalBudgeted - totalSpent >= 0 ? 'text-emerald-600' : 'text-red-500' },
          { label: 'Over budget', value: `${overCount} categories`, color: overCount > 0 ? 'text-red-500' : 'text-emerald-600' },
        ].map(m => (
          <div key={m.label} className="metric-card">
            <p className="text-xs text-gray-500 mb-1">{m.label}</p>
            <p className={`text-lg font-semibold ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Budget table */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <p className="font-medium text-gray-900">Categories</p>
          <div className="flex gap-2">
            <button className="btn-secondary text-xs" onClick={getSuggestions} disabled={suggesting}>
              <Sparkles className="w-3.5 h-3.5" />{suggesting ? 'Getting suggestions...' : 'AI Suggest'}
            </button>
            <button className="btn-primary text-xs" onClick={saveAll} disabled={saving}>
              <Save className="w-3.5 h-3.5" />{saving ? 'Saving...' : 'Save all'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
        ) : (
          <div>
            {budgets.map(b => {
              const budgeted = Number(editValues[b.category_id]) || 0
              const pct = budgeted > 0 ? Math.min(100, Math.round((b.spent / budgeted) * 100)) : 0
              const isOver = b.spent > budgeted && budgeted > 0
              const remaining = budgeted - b.spent

              return (
                <div key={b.category_id} className="px-5 py-4 border-b border-gray-50 last:border-0">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: b.category_color }} />
                      <span className="text-sm font-medium text-gray-800">{b.category_name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{formatCurrency(b.spent)} spent</span>
                      {budgeted > 0 && (
                        <span className={`text-xs font-medium ${isOver ? 'text-red-500' : 'text-emerald-600'}`}>
                          {isOver ? `${formatCurrency(Math.abs(remaining))} over` : `${formatCurrency(remaining)} left`}
                        </span>
                      )}
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                        <input
                          type="number"
                          className="input pl-5 w-24 text-sm py-1.5 text-right"
                          placeholder="0"
                          value={editValues[b.category_id] || ''}
                          onChange={e => setEditValues(v => ({ ...v, [b.category_id]: e.target.value }))}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        background: isOver ? '#ef4444' : b.category_color,
                      }}
                    />
                  </div>
                  {budgeted > 0 && (
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                      <span>{pct}% used</span>
                      <span>of {formatCurrency(budgeted)}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}