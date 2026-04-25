'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Transaction, Account, Category } from '@/lib/types'
import { Upload, Search, Plus, Trash2, CheckCircle, AlertCircle, X, Sparkles } from 'lucide-react'
import Papa from 'papaparse'

interface Toast { message: string; type: 'success' | 'error' }
interface Filters { account: string; category: string; type: string; search: string }
interface Rule { id: string; pattern: string; category_id: string; category_name?: string; notes?: string }

function ToastBanner({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
      {toast.message}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
    </div>
  )
}

export default function TransactionsPage() {
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [toast, setToast] = useState<Toast | null>(null)
  const [importSource, setImportSource] = useState<'capital-one' | 'apple-card' | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [filters, setFilters] = useState<Filters>({ account: '', category: '', type: '', search: '' })
  const [newTxn, setNewTxn] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '', amount: '', type: 'expense', account_id: '', category_id: '', notes: ''
  })
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: txns }, { data: accts }, { data: cats }, { data: ruleRows }] = await Promise.all([
      supabase.from('transactions').select('*, account:accounts(id,name,type), category:categories(id,name,color)').eq('user_id', user.id).order('date', { ascending: false }).limit(200),
      supabase.from('accounts').select('*').eq('user_id', user.id).eq('is_active', true),
      supabase.from('categories').select('*').eq('user_id', user.id).order('name'),
      supabase.from('category_rules').select('*, category:categories(name)').eq('user_id', user.id),
    ])
    setTransactions(txns || [])
    setAccounts(accts || [])
    setCategories(cats || [])
    setRules((ruleRows || []).map((r: any) => ({ ...r, category_name: r.category?.name })))
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !importSource) return
    setImporting(true)
    setImportStatus('Reading file...')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data as Record<string, string>[]
        const incomeCategory = categories.find(c => c.is_income)

        const parsed = rows.map(row => {
          if (importSource === 'capital-one') {
            const amount = parseFloat(row['Transaction Amount'] || '0') || 0
            const type = row['Transaction Type'] === 'Credit' ? 'income' : 'expense'
            return {
              id: crypto.randomUUID(),
              user_id: user.id,
              date: row['Transaction Date'] || '',
              description: row['Transaction Description'] || '',
              amount: Math.abs(amount), type,
              account_id: accounts.find(a => a.institution?.toLowerCase().includes('capital one'))?.id || null,
              category_id: type === 'income' ? (incomeCategory?.id || null) : null,
            }
          } else {
            const raw = parseFloat(row['Amount (USD)'] || row['Amount'] || '0') || 0
            const type = row['Type'] === 'Payment' || raw < 0 ? 'income' : 'expense'
            return {
              id: crypto.randomUUID(),
              user_id: user.id,
              date: row['Transaction Date'] || row['Date'] || '',
              description: row['Merchant'] || row['Description'] || '',
              amount: Math.abs(raw), type,
              account_id: accounts.find(a => a.type === 'credit')?.id || null,
              category_id: type === 'income' ? (incomeCategory?.id || null) : null,
            }
          }
        }).filter(r => r.date && r.amount > 0)

        if (parsed.length === 0) {
          showToast('No valid transactions found in file', 'error')
          setImporting(false)
          setImportStatus('')
          return
        }

        const toCategorizeTxns = parsed.filter(t => !t.category_id)
        if (toCategorizeTxns.length > 0) {
          setImportStatus(`AI categorizing ${toCategorizeTxns.length} transactions...`)
          try {
            const response = await fetch('/api/categorize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                transactions: toCategorizeTxns.map(t => ({ id: t.id, description: t.description, amount: t.amount, type: t.type })),
                categories: categories.map(c => ({ id: c.id, name: c.name })),
                rules: rules.map(r => ({ pattern: r.pattern, category_name: r.category_name })),
              }),
            })
            const { categorized } = await response.json()
            if (categorized && Array.isArray(categorized)) {
              const catMap: Record<string, string> = {}
              categorized.forEach((c: { id: string; category_id: string }) => { catMap[c.id] = c.category_id })
              parsed.forEach(t => { if (catMap[t.id]) t.category_id = catMap[t.id] })
            }
          } catch (err) {
            console.error('AI categorization failed:', err)
          }
        }

        setImportStatus(`Saving ${parsed.length} transactions...`)
        const toInsert = parsed.map(({ id, ...rest }) => rest)
        const { error } = await supabase.from('transactions').insert(toInsert)
        if (error) {
          showToast(`Import failed: ${error.message}`, 'error')
        } else {
          showToast(`Imported ${parsed.length} transactions with AI categorization`)
          setShowImportModal(false)
          load()
        }
        setImporting(false)
        setImportStatus('')
        if (fileInputRef.current) fileInputRef.current.value = ''
      },
      error: () => {
        showToast('Could not read file — make sure it is a CSV', 'error')
        setImporting(false)
        setImportStatus('')
      }
    })
  }

  async function addTransaction() {
    if (!newTxn.description || !newTxn.amount || !newTxn.date) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('transactions').insert({
      user_id: user.id, date: newTxn.date, description: newTxn.description,
      amount: Math.abs(parseFloat(newTxn.amount)), type: newTxn.type,
      account_id: newTxn.account_id || null, category_id: newTxn.category_id || null, notes: newTxn.notes || null,
    })
    if (error) { showToast(error.message, 'error'); return }
    showToast('Transaction added')
    setShowAddModal(false)
    setNewTxn({ date: new Date().toISOString().split('T')[0], description: '', amount: '', type: 'expense', account_id: '', category_id: '', notes: '' })
    load()
  }

  async function deleteTransaction(id: string) {
    const { error } = await supabase.from('transactions').delete().eq('id', id)
    if (error) { showToast(error.message, 'error'); return }
    setTransactions(prev => prev.filter(t => t.id !== id))
    showToast('Transaction deleted')
  }

  async function updateCategory(id: string, category_id: string) {
    await supabase.from('transactions').update({ category_id }).eq('id', id)
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, category: categories.find(c => c.id === category_id), category_id } : t))
  }

  async function askAI() {
    if (!aiQuestion.trim()) return
    setAiLoading(true)
    setAiAnswer('')
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: aiQuestion, transactions, categories }),
      })
      const { answer } = await response.json()
      setAiAnswer(answer)
    } catch {
      setAiAnswer('Sorry, could not process that question.')
    }
    setAiLoading(false)
  }

  const filtered = transactions.filter(t => {
    if (filters.account && t.account_id !== filters.account) return false
    if (filters.category && t.category_id !== filters.category) return false
    if (filters.type && t.type !== filters.type) return false
    if (filters.search && !t.description.toLowerCase().includes(filters.search.toLowerCase())) return false
    return true
  })

  const totalFiltered = filtered.reduce((s, t) => t.type === 'expense' ? s + t.amount : s - t.amount, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Transactions</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} transactions{filters.search || filters.account || filters.category || filters.type ? ' (filtered)' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setShowImportModal(true)}><Upload className="w-4 h-4" />Import CSV</button>
          <button className="btn-primary" onClick={() => setShowAddModal(true)}><Plus className="w-4 h-4" />Add</button>
        </div>
      </div>

      {/* AI Natural Language Search */}
      <div className="card">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-500" />
            <input
              className="input pl-9"
              placeholder='Ask anything — "how much did I spend on groceries?" or "what was my biggest expense?"'
              value={aiQuestion}
              onChange={e => setAiQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') askAI() }}
            />
          </div>
          <button className="btn-primary" onClick={askAI} disabled={aiLoading}>
            {aiLoading ? 'Thinking...' : 'Ask'}
          </button>
        </div>
        {aiAnswer && (
          <div className="mt-3 p-3 bg-brand-50 border border-brand-100 rounded-lg text-sm text-gray-700 leading-relaxed">
            {aiAnswer}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input className="input pl-8" placeholder="Search transactions..." value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
        </div>
        <select className="input w-auto" value={filters.account} onChange={e => setFilters(f => ({ ...f, account: e.target.value }))}>
          <option value="">All accounts</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="input w-auto" value={filters.category} onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input w-auto" value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}>
          <option value="">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        {(filters.search || filters.account || filters.category || filters.type) && (
          <button className="btn-ghost text-xs" onClick={() => setFilters({ account: '', category: '', type: '', search: '' })}><X className="w-3.5 h-3.5" />Clear</button>
        )}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 font-medium mb-1">No transactions yet</p>
            <p className="text-sm text-gray-400 mb-4">Import a CSV from Capital One or Apple Card to get started</p>
            <button className="btn-primary" onClick={() => setShowImportModal(true)}><Upload className="w-4 h-4" />Import CSV</button>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 w-24">Date</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Description</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 w-36">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500 w-32 hidden md:table-cell">Account</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 w-28">Amount</th>
                  <th className="w-8 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">{formatDate(t.date)}</td>
                    <td className="px-4 py-2.5 text-gray-800 font-medium max-w-[200px] truncate">{t.description}</td>
                    <td className="px-4 py-2.5">
                      <select className="text-xs border-0 bg-transparent p-0 pr-4 focus:ring-0 focus:outline-none text-gray-600 cursor-pointer appearance-none max-w-[140px]"
                        value={t.category_id || ''} onChange={e => updateCategory(t.id, e.target.value)}>
                        <option value="">Uncategorized</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400 hidden md:table-cell">{(t.account as any)?.name || '—'}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${t.type === 'income' ? 'text-emerald-600' : 'text-gray-800'}`}>
                      {t.type === 'income' ? '+' : ''}{formatCurrency(t.amount)}
                    </td>
                    <td className="px-2 py-2.5">
                      <button onClick={() => deleteTransaction(t.id)} className="text-gray-200 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex justify-between items-center text-sm">
              <span className="text-gray-400">{filtered.length} transactions shown</span>
              <span className="font-semibold text-gray-700">Net: <span className={totalFiltered >= 0 ? 'text-emerald-600' : 'text-red-500'}>{formatCurrency(Math.abs(totalFiltered))}</span></span>
            </div>
          </>
        )}
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget && !importing) setShowImportModal(false) }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900 text-lg">Import CSV</h2>
              {!importing && <button onClick={() => setShowImportModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>}
            </div>
            {importing ? (
              <div className="text-center py-8">
                <Sparkles className="w-8 h-8 text-brand-500 mx-auto mb-3 animate-pulse" />
                <p className="font-medium text-gray-800 mb-1">Importing...</p>
                <p className="text-sm text-gray-500">{importStatus}</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-4">Select your bank then upload the CSV file you exported.</p>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  {[{ id: 'capital-one' as const, label: 'Capital One', sub: 'Checking or Savings' }, { id: 'apple-card' as const, label: 'Apple Card', sub: 'Credit card' }].map(opt => (
                    <button key={opt.id} onClick={() => setImportSource(opt.id)} className={`border-2 rounded-xl p-4 text-left transition-all ${importSource === opt.id ? 'border-brand-500 bg-brand-50' : 'border-gray-100 hover:border-gray-200'}`}>
                      <p className="font-medium text-gray-800 text-sm">{opt.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{opt.sub}</p>
                    </button>
                  ))}
                </div>
                {importSource && (
                  <div>
                    <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
                    <button className="btn-primary w-full justify-center" onClick={() => fileInputRef.current?.click()}>
                      <Sparkles className="w-4 h-4" />Import with AI categorization
                    </button>
                    <p className="text-xs text-gray-400 text-center mt-3">
                      {importSource === 'capital-one' ? 'Capital One → Account → Transactions → Download → CSV' : 'Wallet app → Apple Card → tap month → Export Transactions'}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Add Transaction Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) setShowAddModal(false) }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-gray-900 text-lg">Add Transaction</h2>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Date</label><input className="input" type="date" value={newTxn.date} onChange={e => setNewTxn(p => ({ ...p, date: e.target.value }))} /></div>
                <div><label className="label">Type</label>
                  <select className="input" value={newTxn.type} onChange={e => setNewTxn(p => ({ ...p, type: e.target.value }))}>
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </div>
              </div>
              <div><label className="label">Description</label><input className="input" placeholder="e.g. Wegmans" value={newTxn.description} onChange={e => setNewTxn(p => ({ ...p, description: e.target.value }))} /></div>
              <div><label className="label">Amount</label>
                <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                  <input className="input pl-6" type="number" placeholder="0.00" value={newTxn.amount} onChange={e => setNewTxn(p => ({ ...p, amount: e.target.value }))} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Account</label>
                  <select className="input" value={newTxn.account_id} onChange={e => setNewTxn(p => ({ ...p, account_id: e.target.value }))}>
                    <option value="">No account</option>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div><label className="label">Category</label>
                  <select className="input" value={newTxn.category_id} onChange={e => setNewTxn(p => ({ ...p, category_id: e.target.value }))}>
                    <option value="">Uncategorized</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div><label className="label">Notes (optional)</label><input className="input" placeholder="Any extra detail" value={newTxn.notes} onChange={e => setNewTxn(p => ({ ...p, notes: e.target.value }))} /></div>
              <div className="flex gap-2 pt-1">
                <button className="btn-primary flex-1 justify-center" onClick={addTransaction}>Add transaction</button>
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