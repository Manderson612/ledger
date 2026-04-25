'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import type { Category } from '@/lib/types'
import { Plus, Trash2, CheckCircle, AlertCircle, X, Sparkles, Check } from 'lucide-react'
import { format, startOfMonth, endOfMonth, addMonths } from 'date-fns'

interface Toast { message: string; type: 'success' | 'error' }
interface Bill {
  id: string
  name: string
  amount: number
  due_day: number
  category_id?: string
  is_active: boolean
  auto_pay: boolean
  category?: { name: string; color: string }
}
interface BillWithStatus extends Bill {
  dueDate: Date
  isPaid: boolean
  isUpcoming: boolean
  isOverdue: boolean
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

export default function BillsPage() {
  const supabase = createClient()
  const [bills, setBills] = useState<BillWithStatus[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newBill, setNewBill] = useState({ name: '', amount: '', due_day: '', category_id: '', auto_pay: false })

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const [{ data: billRows }, { data: cats }, { data: txns }] = await Promise.all([
      supabase.from('bills').select('*, category:categories(name,color)').eq('user_id', user.id).eq('is_active', true).order('due_day'),
      supabase.from('categories').select('*').eq('user_id', user.id).order('name'),
      supabase.from('transactions').select('description, amount, date').eq('user_id', user.id)
        .gte('date', format(startOfMonth(new Date()), 'yyyy-MM-dd'))
        .lte('date', format(endOfMonth(new Date()), 'yyyy-MM-dd')),
    ])

    const today = new Date()
    const paidDescriptions = new Set((txns || []).map(t => t.description.toLowerCase()))

    const withStatus: BillWithStatus[] = (billRows || []).map(b => {
      const dueDate = new Date(today.getFullYear(), today.getMonth(), b.due_day)
      if (dueDate < startOfMonth(today)) dueDate.setMonth(dueDate.getMonth() + 1)
      const isPaid = Array.from(paidDescriptions).some(d => d.includes(b.name.toLowerCase()) || b.name.toLowerCase().includes(d))
      const daysUntil = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      return {
        ...b,
        dueDate,
        isPaid,
        isUpcoming: !isPaid && daysUntil <= 7 && daysUntil >= 0,
        isOverdue: !isPaid && daysUntil < 0,
      }
    })

    setBills(withStatus)
    setCategories(cats || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function addBill() {
    if (!newBill.name || !newBill.amount || !newBill.due_day) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { error } = await supabase.from('bills').insert({
      user_id: user.id,
      name: newBill.name,
      amount: Number(newBill.amount),
      due_day: Number(newBill.due_day),
      category_id: newBill.category_id || null,
      auto_pay: newBill.auto_pay,
    })

    if (error) { showToast(error.message, 'error'); return }
    showToast('Bill added')
    setShowAddModal(false)
    setNewBill({ name: '', amount: '', due_day: '', category_id: '', auto_pay: false })
    load()
  }

  async function deleteBill(id: string) {
    await supabase.from('bills').update({ is_active: false }).eq('id', id)
    setBills(prev => prev.filter(b => b.id !== id))
    showToast('Bill removed')
  }

  async function detectBills() {
    setDetecting(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const threeMonthsAgo = format(new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1), 'yyyy-MM-dd')
    const { data: txns } = await supabase.from('transactions')
      .select('description, amount, date')
      .eq('user_id', user.id)
      .eq('type', 'expense')
      .gte('date', threeMonthsAgo)
      .order('date')

    try {
      const response = await fetch('/api/detect-bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactions: txns || [],
          existing_bills: bills.map(b => b.name),
        }),
      })
      const { detected } = await response.json()
      if (detected && detected.length > 0) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        const toInsert = detected.map((d: { name: string; amount: number; due_day: number }) => ({
          user_id: user.id,
          name: d.name,
          amount: d.amount,
          due_day: d.due_day,
        }))
        await supabase.from('bills').insert(toInsert)
        showToast(`Detected ${detected.length} recurring bills`)
        load()
      } else {
        showToast('No new recurring bills detected')
      }
    } catch {
      showToast('Detection failed', 'error')
    }
    setDetecting(false)
  }

  const totalMonthly = bills.reduce((s, b) => s + b.amount, 0)
  const paidCount = bills.filter(b => b.isPaid).length
  const overdueCount = bills.filter(b => b.isOverdue).length
  const upcomingCount = bills.filter(b => b.isUpcoming).length

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Bills & Subscriptions</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track recurring payments and due dates</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={detectBills} disabled={detecting}>
            <Sparkles className="w-4 h-4" />{detecting ? 'Detecting...' : 'AI Detect'}
          </button>
          <button className="btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus className="w-4 h-4" />Add bill
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Monthly total', value: formatCurrency(totalMonthly), color: 'text-gray-900' },
          { label: 'Paid this month', value: `${paidCount} of ${bills.length}`, color: 'text-emerald-600' },
          { label: 'Upcoming (7 days)', value: String(upcomingCount), color: upcomingCount > 0 ? 'text-amber-500' : 'text-gray-900' },
          { label: 'Overdue', value: String(overdueCount), color: overdueCount > 0 ? 'text-red-500' : 'text-gray-900' },
        ].map(m => (
          <div key={m.label} className="metric-card">
            <p className="text-xs text-gray-500 mb-1">{m.label}</p>
            <p className={`text-lg font-semibold ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Bills list */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
        ) : bills.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 font-medium mb-1">No bills yet</p>
            <p className="text-sm text-gray-400 mb-4">Add bills manually or let AI detect them from your transactions</p>
            <div className="flex gap-2 justify-center">
              <button className="btn-secondary" onClick={detectBills}><Sparkles className="w-4 h-4" />AI Detect</button>
              <button className="btn-primary" onClick={() => setShowAddModal(true)}><Plus className="w-4 h-4" />Add bill</button>
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 font-medium text-gray-500">Bill</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 w-24 hidden sm:table-cell">Due</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 w-28 hidden md:table-cell">Category</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500 w-24">Amount</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500 w-24">Status</th>
                <th className="w-8 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {bills.map(b => (
                <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-800">{b.name}</p>
                      {b.auto_pay && <span className="badge badge-blue text-xs">Auto</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 hidden sm:table-cell">
                    {format(b.dueDate, 'MMM d')}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {b.category ? (
                      <span className="badge badge-gray">{(b.category as any).name}</span>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800">{formatCurrency(b.amount)}</td>
                  <td className="px-4 py-3 text-center">
                    {b.isPaid ? (
                      <span className="badge badge-green">Paid</span>
                    ) : b.isOverdue ? (
                      <span className="badge badge-red">Overdue</span>
                    ) : b.isUpcoming ? (
                      <span className="badge badge-amber">Due soon</span>
                    ) : (
                      <span className="badge badge-gray">Upcoming</span>
                    )}
                  </td>
                  <td className="px-2 py-3">
                    <button onClick={() => deleteBill(b.id)} className="text-gray-200 hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add bill modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setShowAddModal(false) }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900 text-lg">Add Bill</h2>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div><label className="label">Bill name</label><input className="input" placeholder="e.g. Mortgage" value={newBill.name} onChange={e => setNewBill(p => ({ ...p, name: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Amount</label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input className="input pl-6" type="number" placeholder="0.00" value={newBill.amount} onChange={e => setNewBill(p => ({ ...p, amount: e.target.value }))} /></div>
                </div>
                <div><label className="label">Due day of month</label>
                  <input className="input" type="number" min={1} max={31} placeholder="1" value={newBill.due_day} onChange={e => setNewBill(p => ({ ...p, due_day: e.target.value }))} />
                </div>
              </div>
              <div><label className="label">Category (optional)</label>
                <select className="input" value={newBill.category_id} onChange={e => setNewBill(p => ({ ...p, category_id: e.target.value }))}>
                  <option value="">No category</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="autopay" checked={newBill.auto_pay} onChange={e => setNewBill(p => ({ ...p, auto_pay: e.target.checked }))} className="rounded" />
                <label htmlFor="autopay" className="text-sm text-gray-700">Auto-pay enabled</label>
              </div>
              <div className="flex gap-2 pt-1">
                <button className="btn-primary flex-1 justify-center" onClick={addBill}>Add bill</button>
                <button className="btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}