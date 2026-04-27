'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency } from '@/lib/utils'
import type { IncomeSettings, Account } from '@/lib/types'
import { User, Users, CreditCard, FileSpreadsheet, Plus, Trash2, Save, CheckCircle, AlertCircle, Brain, Tag } from 'lucide-react'

interface Toast { message: string; type: 'success' | 'error' }
interface AccountForm { name: string; type: string; institution: string; balance: string }
interface Rule {
  id: string
  pattern: string
  category_id: string | null
  category_name?: string
  notes?: string
  transaction_type: 'income' | 'expense' | 'transfer'
  is_recurring: boolean
  recurring_period: string | null
}
interface Category { id: string; name: string; color: string; is_income: boolean }

const PERIODS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'semi-monthly', label: 'Semi-monthly' },
  { value: 'bi-weekly', label: 'Bi-weekly' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'annual', label: 'Annual' },
]

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="w-9 h-9 bg-brand-50 border border-brand-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-brand-600" />
      </div>
      <div>
        <h2 className="font-semibold text-gray-900">{title}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>
}

function TypeBadge({ type }: { type: string }) {
  const styles =
    type === 'income' ? 'bg-emerald-50 text-emerald-700' :
    type === 'transfer' ? 'bg-gray-100 text-gray-500' :
    'bg-red-50 text-red-600'
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${styles}`}>{type}</span>
}

const PRESET_COLORS = ['#1D9E75','#378ADD','#EF9F27','#7F77DD','#D85A30','#D4537E','#639922','#5DCAA5','#888780','#4dab8e']

export default function SettingsPage() {
  const supabase = createClient()
  const [toast, setToast] = useState<Toast | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const [primaryIncome, setPrimaryIncome] = useState<Partial<IncomeSettings>>({
    person: 'primary', display_name: 'Matt', pay_schedule: 'semi-monthly',
    pay_day_1: 7, pay_day_2: 22, commission_on_paycheck: 2, avg_monthly_commission: 0,
  })
  const [partnerIncome, setPartnerIncome] = useState<Partial<IncomeSettings>>({
    person: 'partner', display_name: 'Megan', pay_schedule: 'bi-weekly',
    commission_on_paycheck: 1, avg_monthly_commission: 0,
  })
  const [accounts, setAccounts] = useState<Account[]>([])
  const [newAccount, setNewAccount] = useState<AccountForm>({ name: '', type: 'checking', institution: '', balance: '' })
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [rules, setRules] = useState<Rule[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [showAddRule, setShowAddRule] = useState(false)
  const [newRule, setNewRule] = useState<{
    pattern: string; category_id: string; notes: string;
    transaction_type: 'income' | 'expense' | 'transfer';
    is_recurring: boolean; recurring_period: string;
  }>({ pattern: '', category_id: '', notes: '', transaction_type: 'expense', is_recurring: false, recurring_period: '' })
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [newCategory, setNewCategory] = useState({ name: '', color: '#378ADD', is_income: false })

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: incomeRows }, { data: accountRows }, { data: ruleRows }, { data: catRows }] = await Promise.all([
      supabase.from('income_settings').select('*').eq('user_id', user.id),
      supabase.from('accounts').select('*').eq('user_id', user.id).eq('is_active', true).order('created_at'),
      supabase.from('category_rules').select('*, category:categories(name)').eq('user_id', user.id),
      supabase.from('categories').select('*').eq('user_id', user.id).order('name'),
    ])
    if (incomeRows) {
      const primary = incomeRows.find((r: any) => r.person === 'primary')
      const partner = incomeRows.find((r: any) => r.person === 'partner')
      if (primary) setPrimaryIncome(primary)
      if (partner) setPartnerIncome(partner)
    }
    if (accountRows) setAccounts(accountRows)
    if (ruleRows) setRules(ruleRows.map((r: any) => ({ ...r, category_name: r.category?.name })))
    if (catRows) setCategories(catRows)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function saveIncome(person: 'primary' | 'partner') {
    setSaving(person)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const payload = person === 'primary' ? primaryIncome : partnerIncome
    const { error } = await supabase.from('income_settings').upsert({
      ...payload, user_id: user.id, person,
      annual_salary: payload.annual_salary ? Number(payload.annual_salary) : null,
      net_per_paycheck: payload.net_per_paycheck ? Number(payload.net_per_paycheck) : null,
      avg_monthly_commission: payload.avg_monthly_commission ? Number(payload.avg_monthly_commission) : 0,
    }, { onConflict: 'user_id,person' })
    setSaving(null)
    error ? showToast(error.message, 'error') : showToast(`${payload.display_name}'s income saved`)
  }

  async function addAccount() {
    if (!newAccount.name.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase.from('accounts').insert({
      user_id: user.id, name: newAccount.name, type: newAccount.type,
      institution: newAccount.institution || null,
      balance: newAccount.balance ? Number(newAccount.balance) : 0,
    }).select().single()
    if (error) { showToast(error.message, 'error'); return }
    setAccounts(prev => [...prev, data])
    setNewAccount({ name: '', type: 'checking', institution: '', balance: '' })
    setShowAddAccount(false)
    showToast('Account added')
  }

  async function deleteAccount(id: string) {
    const { error } = await supabase.from('accounts').update({ is_active: false }).eq('id', id)
    if (error) { showToast(error.message, 'error'); return }
    setAccounts(prev => prev.filter(a => a.id !== id))
    showToast('Account removed')
  }

  async function addCategory() {
    if (!newCategory.name.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase.from('categories').insert({
      user_id: user.id, name: newCategory.name, color: newCategory.color, is_income: newCategory.is_income,
    }).select().single()
    if (error) { showToast(error.message, 'error'); return }
    setCategories(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewCategory({ name: '', color: '#378ADD', is_income: false })
    setShowAddCategory(false)
    showToast('Category added')
  }

  async function deleteCategory(id: string) {
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) { showToast(error.message, 'error'); return }
    setCategories(prev => prev.filter(c => c.id !== id))
    showToast('Category deleted')
  }

  async function addRule() {
    if (!newRule.pattern.trim()) return
    if (newRule.transaction_type !== 'transfer' && !newRule.category_id) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data, error } = await supabase.from('category_rules').insert({
      user_id: user.id,
      pattern: newRule.pattern.trim(),
      category_id: newRule.transaction_type === 'transfer' ? null : newRule.category_id || null,
      notes: newRule.notes || null,
      transaction_type: newRule.transaction_type,
      is_recurring: newRule.is_recurring,
      recurring_period: newRule.is_recurring && newRule.recurring_period ? newRule.recurring_period : null,
    }).select('*, category:categories(name)').single()
    if (error) { showToast(error.message, 'error'); return }
    setRules(prev => [...prev, { ...data, category_name: (data as any).category?.name }])
    setNewRule({ pattern: '', category_id: '', notes: '', transaction_type: 'expense', is_recurring: false, recurring_period: '' })
    setShowAddRule(false)
    showToast('Rule added')
  }

  async function deleteRule(id: string) {
    await supabase.from('category_rules').delete().eq('id', id)
    setRules(prev => prev.filter(r => r.id !== id))
    showToast('Rule deleted')
  }

  const dotColor = (type: string) => type === 'checking' ? 'bg-blue-400' : type === 'savings' ? 'bg-emerald-400' : type === 'credit' ? 'bg-amber-400' : type === 'investment' ? 'bg-purple-400' : 'bg-gray-400'

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Set up your income, accounts, and import preferences</p>
      </div>

      {/* Your Income */}
      <div className="card">
        <SectionHeader icon={User} title="Your Income — Matt" subtitle="Your semi-monthly salary and commission structure" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Field label="Display name"><input className="input" value={primaryIncome.display_name || ''} onChange={e => setPrimaryIncome(p => ({ ...p, display_name: e.target.value }))} /></Field>
          <Field label="Annual base salary"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span><input className="input pl-6" type="number" placeholder="78000" value={primaryIncome.annual_salary || ''} onChange={e => setPrimaryIncome(p => ({ ...p, annual_salary: Number(e.target.value) }))} /></div></Field>
          <Field label="Pay schedule"><select className="input" value={primaryIncome.pay_schedule || 'semi-monthly'} onChange={e => setPrimaryIncome(p => ({ ...p, pay_schedule: e.target.value as IncomeSettings['pay_schedule'] }))}><option value="semi-monthly">Semi-monthly (7th &amp; 22nd)</option><option value="bi-weekly">Bi-weekly</option><option value="monthly">Monthly</option></select></Field>
          <Field label="Net pay per paycheck (after tax)"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span><input className="input pl-6" type="number" placeholder="3250" value={primaryIncome.net_per_paycheck || ''} onChange={e => setPrimaryIncome(p => ({ ...p, net_per_paycheck: Number(e.target.value) }))} /></div></Field>
          {primaryIncome.pay_schedule === 'semi-monthly' && <>
            <Field label="First paycheck day"><input className="input" type="number" min={1} max={31} placeholder="7" value={primaryIncome.pay_day_1 || ''} onChange={e => setPrimaryIncome(p => ({ ...p, pay_day_1: Number(e.target.value) }))} /></Field>
            <Field label="Second paycheck day"><input className="input" type="number" min={1} max={31} placeholder="22" value={primaryIncome.pay_day_2 || ''} onChange={e => setPrimaryIncome(p => ({ ...p, pay_day_2: Number(e.target.value) }))} /></Field>
          </>}
          <Field label="Average monthly commission (net)"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span><input className="input pl-6" type="number" placeholder="2100" value={primaryIncome.avg_monthly_commission || ''} onChange={e => setPrimaryIncome(p => ({ ...p, avg_monthly_commission: Number(e.target.value) }))} /></div></Field>
          <Field label="Commission paid on which paycheck?"><select className="input" value={primaryIncome.commission_on_paycheck || 2} onChange={e => setPrimaryIncome(p => ({ ...p, commission_on_paycheck: Number(e.target.value) }))}><option value={1}>1st paycheck (day {primaryIncome.pay_day_1 || 7})</option><option value={2}>2nd paycheck (day {primaryIncome.pay_day_2 || 22})</option></select></Field>
        </div>
        {primaryIncome.net_per_paycheck ? <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 mb-4 text-sm text-gray-600"><span className="font-medium text-gray-800">Preview: </span>Day {primaryIncome.pay_day_1 || 7}: <strong>{formatCurrency(primaryIncome.commission_on_paycheck === 1 ? (primaryIncome.net_per_paycheck || 0) + (primaryIncome.avg_monthly_commission || 0) : primaryIncome.net_per_paycheck || 0)}</strong>{' · '}Day {primaryIncome.pay_day_2 || 22}: <strong>{formatCurrency(primaryIncome.commission_on_paycheck === 2 ? (primaryIncome.net_per_paycheck || 0) + (primaryIncome.avg_monthly_commission || 0) : primaryIncome.net_per_paycheck || 0)}</strong></div> : null}
        <button className="btn-primary" onClick={() => saveIncome('primary')} disabled={saving === 'primary'}><Save className="w-4 h-4" />{saving === 'primary' ? 'Saving...' : 'Save'}</button>
      </div>

      {/* Megan's Income */}
      <div className="card">
        <SectionHeader icon={Users} title="Megan's Income" subtitle="Bi-weekly paycheck schedule" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Field label="Display name"><input className="input" value={partnerIncome.display_name || ''} onChange={e => setPartnerIncome(p => ({ ...p, display_name: e.target.value }))} /></Field>
          <Field label="Annual base salary"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span><input className="input pl-6" type="number" placeholder="52000" value={partnerIncome.annual_salary || ''} onChange={e => setPartnerIncome(p => ({ ...p, annual_salary: Number(e.target.value) }))} /></div></Field>
          <Field label="Pay schedule"><select className="input" value={partnerIncome.pay_schedule || 'bi-weekly'} onChange={e => setPartnerIncome(p => ({ ...p, pay_schedule: e.target.value as IncomeSettings['pay_schedule'] }))}><option value="bi-weekly">Bi-weekly (every 2 weeks)</option><option value="semi-monthly">Semi-monthly</option><option value="monthly">Monthly</option></select></Field>
          <Field label="Net pay per paycheck (after tax)"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span><input className="input pl-6" type="number" placeholder="2100" value={partnerIncome.net_per_paycheck || ''} onChange={e => setPartnerIncome(p => ({ ...p, net_per_paycheck: Number(e.target.value) }))} /></div></Field>
          {partnerIncome.pay_schedule === 'bi-weekly' && <Field label="Most recent paycheck date"><input className="input" type="date" value={partnerIncome.last_paycheck_date || ''} onChange={e => setPartnerIncome(p => ({ ...p, last_paycheck_date: e.target.value }))} /></Field>}
        </div>
        <button className="btn-primary" onClick={() => saveIncome('partner')} disabled={saving === 'partner'}><Save className="w-4 h-4" />{saving === 'partner' ? 'Saving...' : 'Save'}</button>
      </div>

      {/* Accounts */}
      <div className="card">
        <SectionHeader icon={CreditCard} title="Accounts" subtitle="Your checking, savings, and credit card accounts" />
        {accounts.length > 0 && (
          <div className="mb-4 border border-gray-100 rounded-lg overflow-hidden">
            {accounts.map((a, i) => (
              <div key={a.id} className={`flex items-center justify-between px-4 py-3 ${i < accounts.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${dotColor(a.type)}`} />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{a.name}</p>
                    <p className="text-xs text-gray-400">{a.institution ? `${a.institution} · ` : ''}<span className="capitalize">{a.type}</span></p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-semibold text-gray-700">{formatCurrency(a.balance)}</span>
                  <button onClick={() => deleteAccount(a.id)} className="text-gray-300 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
        {showAddAccount ? (
          <div className="border border-gray-200 rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium text-gray-700">Add account</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Account name"><input className="input" placeholder="Capital One Checking" value={newAccount.name} onChange={e => setNewAccount(p => ({ ...p, name: e.target.value }))} /></Field>
              <Field label="Type"><select className="input" value={newAccount.type} onChange={e => setNewAccount(p => ({ ...p, type: e.target.value }))}><option value="checking">Checking</option><option value="savings">Savings</option><option value="credit">Credit card</option><option value="investment">Investment</option><option value="other">Other</option></select></Field>
              <Field label="Institution (optional)"><input className="input" placeholder="Capital One" value={newAccount.institution} onChange={e => setNewAccount(p => ({ ...p, institution: e.target.value }))} /></Field>
              <Field label="Current balance"><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span><input className="input pl-6" type="number" placeholder="0.00" value={newAccount.balance} onChange={e => setNewAccount(p => ({ ...p, balance: e.target.value }))} /></div></Field>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={addAccount}><Plus className="w-4 h-4" />Add account</button>
              <button className="btn-secondary" onClick={() => setShowAddAccount(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn-secondary" onClick={() => setShowAddAccount(true)}><Plus className="w-4 h-4" />Add account</button>
        )}
      </div>

      {/* Categories */}
      <div className="card">
        <SectionHeader icon={Tag} title="Categories" subtitle="Manage your spending and income categories" />
        {categories.length > 0 && (
          <div className="mb-4 border border-gray-100 rounded-lg overflow-hidden">
            {categories.map((c, i) => (
              <div key={c.id} className={`flex items-center justify-between px-4 py-3 ${i < categories.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.color }} />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{c.name}</p>
                    <p className="text-xs text-gray-400">{c.is_income ? 'Income' : 'Expense'}</p>
                  </div>
                </div>
                <button onClick={() => deleteCategory(c.id)} className="text-gray-300 hover:text-red-400 transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
        {showAddCategory ? (
          <div className="border border-gray-200 rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium text-gray-700">Add category</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Category name"><input className="input" placeholder="e.g. Golf" value={newCategory.name} onChange={e => setNewCategory(p => ({ ...p, name: e.target.value }))} /></Field>
              <Field label="Color">
                <div className="flex gap-2 flex-wrap mt-1">
                  {PRESET_COLORS.map(color => (
                    <button key={color} onClick={() => setNewCategory(p => ({ ...p, color }))}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${newCategory.color === color ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                      style={{ background: color }} />
                  ))}
                </div>
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_income" checked={newCategory.is_income} onChange={e => setNewCategory(p => ({ ...p, is_income: e.target.checked }))} className="rounded" />
              <label htmlFor="is_income" className="text-sm text-gray-700">This is an income category</label>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={addCategory}><Plus className="w-4 h-4" />Add category</button>
              <button className="btn-secondary" onClick={() => setShowAddCategory(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn-secondary" onClick={() => setShowAddCategory(true)}><Plus className="w-4 h-4" />Add category</button>
        )}
      </div>

      {/* Category Rules */}
      <div className="card">
        <SectionHeader icon={Brain} title="Category Rules" subtitle="Rules are applied automatically when importing — AI only handles unmatched transactions" />

        {rules.length > 0 && (
          <div className="mb-4 border border-gray-100 rounded-lg overflow-hidden">
            {rules.map((r, i) => (
              <div key={r.id} className={`flex items-start justify-between px-4 py-3 ${i < rules.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-800">{r.pattern}</p>
                    <TypeBadge type={r.transaction_type || 'expense'} />
                    {r.is_recurring && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-50 text-brand-600 font-medium">
                        {r.recurring_period || 'recurring'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    → {r.transaction_type === 'transfer' ? 'Transfer (no category)' : r.category_name || 'No category'}
                    {r.notes ? ` · ${r.notes}` : ''}
                  </p>
                </div>
                <button onClick={() => deleteRule(r.id)} className="text-gray-300 hover:text-red-400 transition-colors ml-4 flex-shrink-0"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}

        {showAddRule ? (
          <div className="border border-gray-200 rounded-lg p-4 space-y-4">
            <p className="text-sm font-medium text-gray-700">Add rule</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Pattern (merchant name or keyword)">
                <input className="input" placeholder="e.g. NIAGARA'S CHOICE" value={newRule.pattern} onChange={e => setNewRule(p => ({ ...p, pattern: e.target.value }))} />
              </Field>
              <Field label="Transaction type">
                <select className="input" value={newRule.transaction_type} onChange={e => setNewRule(p => ({ ...p, transaction_type: e.target.value as any, category_id: '' }))}>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="transfer">Transfer</option>
                </select>
              </Field>
              {newRule.transaction_type !== 'transfer' && (
                <Field label="Category">
                  <select className="input" value={newRule.category_id} onChange={e => setNewRule(p => ({ ...p, category_id: e.target.value }))}>
                    <option value="">Select category</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Notes (optional)">
                <input className="input" placeholder="e.g. Car payment" value={newRule.notes} onChange={e => setNewRule(p => ({ ...p, notes: e.target.value }))} />
              </Field>
            </div>

            {/* Recurring toggle */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox" id="rule_recurring"
                  checked={newRule.is_recurring}
                  onChange={e => setNewRule(p => ({ ...p, is_recurring: e.target.checked }))}
                  className="rounded border-gray-300"
                />
                <label htmlFor="rule_recurring" className="text-sm text-gray-700">Recurring</label>
              </div>
              {newRule.is_recurring && (
                <select
                  className="input w-auto text-sm"
                  value={newRule.recurring_period}
                  onChange={e => setNewRule(p => ({ ...p, recurring_period: e.target.value }))}
                >
                  <option value="">Select period...</option>
                  {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              )}
            </div>

            <div className="flex gap-2">
              <button
                className="btn-primary"
                onClick={addRule}
                disabled={!newRule.pattern || (newRule.transaction_type !== 'transfer' && !newRule.category_id)}
              >
                <Plus className="w-4 h-4" />Add rule
              </button>
              <button className="btn-secondary" onClick={() => setShowAddRule(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <button className="btn-secondary" onClick={() => setShowAddRule(true)}><Plus className="w-4 h-4" />Add rule</button>
        )}
      </div>

      {/* CSV Mappings */}
      <div className="card">
        <SectionHeader icon={FileSpreadsheet} title="CSV Import Mappings" subtitle="How Ledger reads your bank export files" />
        <div className="space-y-4">
          {[
            { name: 'Capital One Checking', badge: 'Checking', badgeClass: 'badge-blue', cols: [['Date','Transaction Date'],['Description','Transaction Description'],['Amount','Transaction Amount'],['Type','Transaction Type']], tip: 'Capital One online → Account → Transactions → Download → CSV' },
            { name: 'Capital One Cards', badge: 'Savor / Quicksilver', badgeClass: 'badge-gray', cols: [['Date','Transaction Date'],['Description','Description'],['Debit','Debit'],['Credit','Credit']], tip: 'Capital One online → Account → Transactions → Download → CSV' },
            { name: 'Apple Card', badge: 'Credit', badgeClass: 'badge-gray', cols: [['Date','Transaction Date'],['Description','Merchant'],['Amount','Amount (USD)'],['Type','Type']], tip: 'Wallet app → Apple Card → tap month → Export Transactions → CSV' },
          ].map(bank => (
            <div key={bank.name} className="border border-gray-100 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-700">{bank.name}</span>
                <span className={`badge ${bank.badgeClass}`}>{bank.badge}</span>
              </div>
              <div className="px-4 py-3 space-y-1.5">
                {bank.cols.map(([field, col]) => (
                  <div key={field} className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">{field}</span>
                    <code className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700">{col}</code>
                  </div>
                ))}
                <p className="text-xs text-gray-400 mt-3">{bank.tip}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}
    </div>
  )
}
