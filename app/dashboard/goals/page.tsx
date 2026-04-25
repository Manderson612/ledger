'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import { Plus, Trash2, CheckCircle, AlertCircle, X, Edit2 } from 'lucide-react'
import { format } from 'date-fns'

interface Toast { message: string; type: 'success' | 'error' }
interface Goal {
  id: string
  name: string
  target_amount: number
  current_amount: number
  target_date?: string
  color: string
  is_complete: boolean
}

const COLORS = ['#1D9E75','#378ADD','#EF9F27','#7F77DD','#D85A30','#D4537E','#639922','#5DCAA5']

function ToastBanner({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
      {toast.message}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
    </div>
  )
}

export default function GoalsPage() {
  const supabase = createClient()
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<Toast | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null)
  const [newGoal, setNewGoal] = useState({
    name: '', target_amount: '', current_amount: '', target_date: '', color: COLORS[0]
  })

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('goals').select('*').eq('user_id', user.id).order('created_at')
    setGoals(data || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function addGoal() {
    if (!newGoal.name || !newGoal.target_amount) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('goals').insert({
      user_id: user.id,
      name: newGoal.name,
      target_amount: Number(newGoal.target_amount),
      current_amount: Number(newGoal.current_amount) || 0,
      target_date: newGoal.target_date || null,
      color: newGoal.color,
    })
    if (error) { showToast(error.message, 'error'); return }
    showToast('Goal added')
    setShowAddModal(false)
    setNewGoal({ name: '', target_amount: '', current_amount: '', target_date: '', color: COLORS[0] })
    load()
  }

  async function updateGoal() {
    if (!editingGoal) return
    const { error } = await supabase.from('goals').update({
      name: editingGoal.name,
      target_amount: editingGoal.target_amount,
      current_amount: editingGoal.current_amount,
      target_date: editingGoal.target_date || null,
      color: editingGoal.color,
      is_complete: editingGoal.current_amount >= editingGoal.target_amount,
    }).eq('id', editingGoal.id)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Goal updated')
    setEditingGoal(null)
    load()
  }

  async function deleteGoal(id: string) {
    await supabase.from('goals').delete().eq('id', id)
    setGoals(prev => prev.filter(g => g.id !== id))
    showToast('Goal deleted')
  }

  const totalSaved = goals.reduce((s, g) => s + g.current_amount, 0)
  const totalTarget = goals.reduce((s, g) => s + g.target_amount, 0)
  const completedCount = goals.filter(g => g.is_complete).length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Savings Goals</h1>
          <p className="text-sm text-gray-500 mt-0.5">Track progress toward what matters most</p>
        </div>
        <button className="btn-primary" onClick={() => setShowAddModal(true)}>
          <Plus className="w-4 h-4" />Add goal
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total saved', value: formatCurrency(totalSaved) },
          { label: 'Total target', value: formatCurrency(totalTarget) },
          { label: 'Goals completed', value: `${completedCount} of ${goals.length}` },
        ].map(m => (
          <div key={m.label} className="metric-card">
            <p className="text-xs text-gray-500 mb-1">{m.label}</p>
            <p className="text-lg font-semibold text-gray-900">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Goals grid */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
      ) : goals.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-500 font-medium mb-1">No goals yet</p>
          <p className="text-sm text-gray-400 mb-4">Create your first savings goal — Baby Fund, Emergency Fund, vacation, anything</p>
          <button className="btn-primary" onClick={() => setShowAddModal(true)}><Plus className="w-4 h-4" />Add goal</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {goals.map(g => {
            const pct = g.target_amount > 0 ? Math.min(100, Math.round((g.current_amount / g.target_amount) * 100)) : 0
            const remaining = g.target_amount - g.current_amount
            return (
              <div key={g.id} className="card relative">
                {g.is_complete && (
                  <div className="absolute top-3 right-3">
                    <span className="badge badge-green">Complete</span>
                  </div>
                )}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: g.color }} />
                    <h3 className="font-semibold text-gray-900">{g.name}</h3>
                  </div>
                  <div className="flex gap-1 ml-2">
                    <button onClick={() => setEditingGoal(g)} className="text-gray-300 hover:text-gray-500 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                    <button onClick={() => deleteGoal(g.id)} className="text-gray-300 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>

                {g.target_date && (
                  <p className="text-xs text-gray-400 mb-3">Target: {format(new Date(g.target_date), 'MMM yyyy')}</p>
                )}

                <div className="progress-track mb-2">
                  <div className="progress-fill" style={{ width: `${pct}%`, background: g.color }} />
                </div>

                <div className="flex justify-between text-sm mb-1">
                  <span className="font-semibold text-gray-900">{formatCurrency(g.current_amount)}</span>
                  <span className="text-gray-400">{formatCurrency(g.target_amount)}</span>
                </div>

                <div className="flex justify-between text-xs text-gray-400">
                  <span>{pct}% funded</span>
                  {!g.is_complete && <span>{formatCurrency(remaining)} to go</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add goal modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setShowAddModal(false) }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900 text-lg">Add Goal</h2>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div><label className="label">Goal name</label><input className="input" placeholder="e.g. Baby Fund" value={newGoal.name} onChange={e => setNewGoal(p => ({ ...p, name: e.target.value }))} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Target amount</label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input className="input pl-6" type="number" placeholder="5000" value={newGoal.target_amount} onChange={e => setNewGoal(p => ({ ...p, target_amount: e.target.value }))} /></div>
                </div>
                <div><label className="label">Already saved</label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input className="input pl-6" type="number" placeholder="0" value={newGoal.current_amount} onChange={e => setNewGoal(p => ({ ...p, current_amount: e.target.value }))} /></div>
                </div>
              </div>
              <div><label className="label">Target date (optional)</label><input className="input" type="date" value={newGoal.target_date} onChange={e => setNewGoal(p => ({ ...p, target_date: e.target.value }))} /></div>
              <div>
                <label className="label">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setNewGoal(p => ({ ...p, color: c }))}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${newGoal.color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                      style={{ background: c }} />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button className="btn-primary flex-1 justify-center" onClick={addGoal}>Add goal</button>
                <button className="btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit goal modal */}
      {editingGoal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setEditingGoal(null) }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900 text-lg">Edit Goal</h2>
              <button onClick={() => setEditingGoal(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div><label className="label">Goal name</label><input className="input" value={editingGoal.name} onChange={e => setEditingGoal(p => p ? ({ ...p, name: e.target.value }) : p)} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Target amount</label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input className="input pl-6" type="number" value={editingGoal.target_amount} onChange={e => setEditingGoal(p => p ? ({ ...p, target_amount: Number(e.target.value) }) : p)} /></div>
                </div>
                <div><label className="label">Current amount</label>
                  <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                    <input className="input pl-6" type="number" value={editingGoal.current_amount} onChange={e => setEditingGoal(p => p ? ({ ...p, current_amount: Number(e.target.value) }) : p)} /></div>
                </div>
              </div>
              <div><label className="label">Target date</label><input className="input" type="date" value={editingGoal.target_date || ''} onChange={e => setEditingGoal(p => p ? ({ ...p, target_date: e.target.value }) : p)} /></div>
              <div>
                <label className="label">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map(c => (
                    <button key={c} onClick={() => setEditingGoal(p => p ? ({ ...p, color: c }) : p)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${editingGoal.color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                      style={{ background: c }} />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button className="btn-primary flex-1 justify-center" onClick={updateGoal}>Save changes</button>
                <button className="btn-secondary" onClick={() => setEditingGoal(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <ToastBanner toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}