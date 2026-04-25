'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, getPaychecksForMonth } from '@/lib/utils'
import type { IncomeSettings, Bill } from '@/lib/types'
import { format, startOfMonth, addMonths, subMonths } from 'date-fns'
import { ChevronLeft, ChevronRight, DollarSign } from 'lucide-react'

interface PaycheckWithBills {
  date: string
  person: string
  amount: number
  hasCommission: boolean
  label: string
  bills: { name: string; amount: number; due_day: number }[]
  allocated: number
  remaining: number
}

export default function PlannerPage() {
  const supabase = createClient()
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()))
  const [paychecks, setPaychecks] = useState<PaycheckWithBills[]>([])
  const [loading, setLoading] = useState(true)
  const [monthIncome, setMonthIncome] = useState(0)
  const [monthBills, setMonthBills] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: incomeSettings }, { data: bills }] = await Promise.all([
      supabase.from('income_settings').select('*').eq('user_id', user.id),
      supabase.from('bills').select('*').eq('user_id', user.id).eq('is_active', true),
    ])

    const allPaychecks: ReturnType<typeof getPaychecksForMonth> = []
    for (const s of (incomeSettings as IncomeSettings[] || [])) {
      allPaychecks.push(...getPaychecksForMonth(s, currentMonth))
    }
    allPaychecks.sort((a, b) => a.date.localeCompare(b.date))

    const totalIncome = allPaychecks.reduce((s, p) => s + p.amount, 0)
    const totalBills = (bills || []).reduce((s: number, b: Bill) => s + b.amount, 0)
    setMonthIncome(totalIncome)
    setMonthBills(totalBills)

    // Assign bills to nearest paycheck before or on due date
    const billList = (bills || []) as Bill[]
    const withBills: PaycheckWithBills[] = allPaychecks.map((p, idx) => {
      const paycheckDay = new Date(p.date).getDate()
      const nextPaycheckDay = allPaychecks[idx + 1] ? new Date(allPaychecks[idx + 1].date).getDate() : 32

      const assignedBills = billList.filter(b => {
        return b.due_day > paycheckDay && b.due_day <= nextPaycheckDay
      })

      const allocated = assignedBills.reduce((s, b) => s + b.amount, 0)
      return {
        ...p,
        bills: assignedBills,
        allocated,
        remaining: p.amount - allocated,
      }
    })

    setPaychecks(withBills)
    setLoading(false)
  }, [supabase, currentMonth])

  useEffect(() => { load() }, [load])

  const personColor = (person: string) => {
    const lower = person.toLowerCase()
    if (lower.includes('matt')) return { bar: '#1D9E75', bg: 'bg-emerald-50', border: 'border-emerald-200' }
    return { bar: '#378ADD', bg: 'bg-blue-50', border: 'border-blue-200' }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Paycheck Planner</h1>
          <p className="text-sm text-gray-500 mt-0.5">Plan spending paycheck by paycheck</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCurrentMonth(m => subMonths(m, 1))} className="btn-secondary px-2.5"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-sm font-medium text-gray-700 min-w-[120px] text-center">{format(currentMonth, 'MMMM yyyy')}</span>
          <button onClick={() => setCurrentMonth(m => addMonths(m, 1))} className="btn-secondary px-2.5"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Month summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="metric-card">
          <p className="text-xs text-gray-500 mb-1">Total income</p>
          <p className="text-xl font-semibold text-emerald-600">{formatCurrency(monthIncome)}</p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-gray-500 mb-1">Fixed bills</p>
          <p className="text-xl font-semibold text-gray-900">{formatCurrency(monthBills)}</p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-gray-500 mb-1">Remaining</p>
          <p className={`text-xl font-semibold ${monthIncome - monthBills >= 0 ? 'text-gray-900' : 'text-red-500'}`}>
            {formatCurrency(monthIncome - monthBills)}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
      ) : paychecks.length === 0 ? (
        <div className="card text-center py-12">
          <DollarSign className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium mb-1">No income set up</p>
          <p className="text-sm text-gray-400 mb-4">Go to Settings to configure your pay schedule</p>
          <a href="/dashboard/settings" className="btn-primary">Go to Settings</a>
        </div>
      ) : (
        <div className="space-y-4">
          {paychecks.map((p, i) => {
            const colors = personColor(p.person)
            const pct = p.amount > 0 ? Math.min(100, Math.round((p.allocated / p.amount) * 100)) : 0
            return (
              <div key={i} className={`card border-l-4 ${colors.border} pl-4`} style={{ borderLeftColor: colors.bar }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">
                      {format(new Date(p.date), 'EEEE, MMMM d')}
                    </p>
                    <p className="font-semibold text-gray-900">{p.label}</p>
                    {p.hasCommission && (
                      <p className="text-xs text-gray-400 mt-0.5">Includes commission</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-semibold text-emerald-600">{formatCurrency(p.amount)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatCurrency(p.remaining)} remaining after bills
                    </p>
                  </div>
                </div>

                {/* Bills assigned to this paycheck */}
                {p.bills.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Bills to cover</p>
                    <div className="space-y-1">
                      {p.bills.map(b => (
                        <div key={b.name} className="flex justify-between text-sm">
                          <span className="text-gray-600">{b.name}</span>
                          <span className="font-medium text-gray-800">{formatCurrency(b.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Allocation bar */}
                <div className="progress-track mt-3">
                  <div
                    className="progress-fill"
                    style={{ width: `${pct}%`, background: pct > 90 ? '#ef4444' : colors.bar }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>{formatCurrency(p.allocated)} allocated to bills</span>
                  <span>{pct}% of paycheck</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}