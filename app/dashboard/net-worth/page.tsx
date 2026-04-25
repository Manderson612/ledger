'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { Plus, Trash2, CheckCircle, AlertCircle, X, Save } from 'lucide-react'
import { format, startOfMonth, subMonths } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

interface Toast { message: string; type: 'success' | 'error' }
interface NWItem {
  id: string
  name: string
  type: 'asset' | 'liability'
  amount: number
  category: string
}
interface Snapshot {
  month: string
  total_assets: number
  total_liabilities: number
  net_worth: number
}

const ASSET_CATEGORIES = ['cash', 'investment', 'property', 'vehicle', 'retirement', 'other']
const LIABILITY_CATEGORIES = ['loan', 'credit', 'other']

function ToastBanner({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
      {toast.message}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
    </div>
  )
}

export default function NetWorthPage() {
  const supabase = createClient()
  const [items, setItems] = useState<NWItem[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<Toast | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', type: 'asset', amount: '', category: 'cash' })
  const [editAmounts, setEditAmounts] = useState<Record<string, string>>({})

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: nwItems }, { data: snaps }] = await Promise.all([
      supabase.from('net_worth_items').select('*').eq('user_id', user.id).order('type').order('name'),
      supabase.from('net_worth_snapshots').select('*').eq('user_id', user.id).order('month').limit(12),
    ])
    setItems(nwItems || [])
    setSnapshots(snaps || [])
    const vals: Record<string, string> = {}
    for (const i of nwItems || []) vals[i.id] = String(i.amount)
    setEditAmounts(vals)
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function addItem() {
    if (!newItem.name || !newItem.amount) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('net_worth_items').insert({
      user_id: user.id,
      name: newItem.name,
      type: newItem.type,
      amount: Number(newItem.amount),
      category: newItem.category,
    })
    if (error) { showToast(error.message, 'error'); return }
    showToast('Item added')
    setShowAddModal(false)
    setNewItem({ name: '', type: 'asset', amount: '', category: 'cash' })
    load()
  }

  async function deleteItem(id: string) {
    await supabase.from('net_worth_items').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
    showToast('Item removed')
  }

  async function saveAmounts() {
    const updates = items.map(i => ({
      id: i.id,
      amount: Number(editAmounts[i.id]) || 0,
      updated_at: new Date().toISOString(),
    }))
    for (const u of updates) {
      await supabase.from('net_worth_items').update({ amount: u.amount, updated_at: u.updated_at }).eq('id', u.id)
    }

    // Save monthly snapshot
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const totalAssets = items.filter(i => i.type === 'asset').reduce((s, i) => s + (Number(editAmounts[i.id]) || 0), 0)
    const totalLiabilities = items.filter(i => i.type === 'liability').reduce((s, i) => s + (Number(editAmounts[i.id]) || 0), 0)
    await supabase.from('net_worth_snapshots').upsert({
      user_id: user.id,
      month: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
      total_assets: totalAssets,
      total_liabilities: totalLiabilities,
    }, { onConflict: 'user_id,month' })

    showToast('Net worth updated')
    load()
  }

  const assets = items.filter(i => i.type === 'asset')
  const liabilities = items.filter(i => i.type === 'liability')
  const totalAssets = assets.reduce((s, i) => s + (Number(editAmounts[i.id]) || i.amount), 0)
  const totalLiabilities = liabilities.reduce((s, i) => s + (Number(editAmounts[i.id]) || i.amount), 0)
  const netWorth = totalAssets - totalLiabilities

  const chartData = snapshots.map(s => ({
    month: format(new Date(s.month), 'MMM yy'),
    'Net Worth': s.net_worth,
    'Assets': s.total_assets,
    'Liabilities': s.total_liabilities,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Net Worth</h1>
          <p className="text-sm text-gray-500 mt-0.5">Your complete financial picture</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setShowAddModal(true)}><Plus className="w-4 h-4" />Add item</button>
          <button className="btn-primary" onClick={saveAmounts}><Save className="w-4 h-4" />Save & snapshot</button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="metric-card">
          <p className="text-xs text-gray-500 mb-1">Total assets</p>
          <p className="text-xl font-semibold text-emerald-600">{formatCurrency(totalAssets)}</p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-gray-500 mb-1">Total liabilities</p>
          <p className="text-xl font-semibold text-red-500">{formatCurrency(totalLiabilities)}</p>
        </div>
        <div className="metric-card">
          <p className="text-xs text-gray-500 mb-1">Net worth</p>
          <p className={`text-xl font-semibold ${netWorth >= 0 ? 'text-gray-900' : 'text-red-500'}`}>{formatCurrency(netWorth)}</p>
        </div>
      </div>

      {/* Chart */}
      {snapshots.length > 1 && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-4">Net Worth Over Time</h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Line type="monotone" dataKey="Net Worth" stroke="#1D9E75" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Assets" stroke="#378ADD" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="Liabilities" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Assets */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center justify-between">
              Assets
              <span className="text-sm font-normal text-emerald-600">{formatCurrency(totalAssets)}</span>
            </h2>
            {assets.length === 0 ? (
              <p className="text-sm text-gray-400">No assets added yet</p>
            ) : (
              <div className="space-y-2">
                {assets.map(i => (
                  <div key={i.id} className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{i.name}</p>
                      <p className="text-xs text-gray-400 capitalize">{i.category}</p>
                    </div>
                    <div className="relative w-32">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                      <input type="number" className="input pl-5 text-sm py-1.5 text-right w-full"
                        value={editAmounts[i.id] || ''} onChange={e => setEditAmounts(v => ({ ...v, [i.id]: e.target.value }))} />
                    </div>
                    <button onClick={() => deleteItem(i.id)} className="text-gray-200 hover:text-red-400 transition-colors flex-shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Liabilities */}
          <div className="card">
            <h2 className="font-semibold text-gray-900 mb-4 flex items-center justify-between">
              Liabilities
              <span className="text-sm font-normal text-red-500">{formatCurrency(totalLiabilities)}</span>
            </h2>
            {liabilities.length === 0 ? (
              <p className="text-sm text-gray-400">No liabilities added yet</p>
            ) : (
              <div className="space-y-2">
                {liabilities.map(i => (
                  <div key={i.id} className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{i.name}</p>
                      <p className="text-xs text-gray-400 capitalize">{i.category}</p>
                    </div>
                    <div className="relative w-32">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">$</span>
                      <input type="number" className="input pl-5 text-sm py-1.5 text-right w-full"
                        value={editAmounts[i.id] || ''} onChange={e => setEditAmounts(v => ({ ...v, [i.id]: e.target.value }))} />
                    </div>
                    <button onClick={() => deleteItem(i.id)} className="text-gray-200 hover:text-red-400 transition-colors flex-shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add item modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setShowAddModal(false) }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900 text-lg">Add Item</h2>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div><label className="label">Name</label><input className="input" placeholder="e.g. Capital One Savings" value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Type</label>
                  <select className="input" value={newItem.type} onChange={e => setNewItem(p => ({ ...p, type: e.target.value, category: e.target.value === 'asset' ? 'cash' : 'loan' }))}>
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                  </select>
                </div>
                <div><label className="label">Category</label>
                  <select className="input" value={newItem.category} onChange={e => setNewItem(p => ({ ...p, category: e.target.value }))}>
                    {(newItem.type === 'asset' ? ASSET_CATEGORIES : LIABILITY_CATEGORIES).map(c => (
                      <option key={c} value={c} className="capitalize">{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div><label className="label">Current value</label>
                <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input className="input pl-6" type="number" placeholder="0.00" value={newItem.amount} onChange={e => setNewItem(p => ({ ...p, amount: e.target.value }))} /></div>
              </div>
              <div className="flex gap-2 pt-1">
                <button className="btn-primary flex-1 justify-center" onClick={addItem}>Add item</button>
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