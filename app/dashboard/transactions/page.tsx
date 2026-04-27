'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Transaction, Account, Category } from '@/lib/types'
import { Upload, Search, Plus, Trash2, CheckCircle, AlertCircle, X, Sparkles, FileText, RefreshCw } from 'lucide-react'
import Papa from 'papaparse'

// ── Types ────────────────────────────────────────────────────────────────────

interface Toast { message: string; type: 'success' | 'error' }
interface Filters { account: string; category: string; type: string; search: string }

type CsvFormat = 'checking' | 'capital-one-card' | 'apple-card'
type ImportStep = 'idle' | 'select' | 'classifying' | 'review'

interface PendingFile {
  fileId: string
  fileName: string
  format: CsvFormat
  detectedCards: string[]        // e.g. ['9043', '1555'] for Quicksilver
  accountId: string              // which account in the DB this maps to
  parsedRows: ParsedRow[]
}

interface ParsedRow {
  date: string
  description: string
  amount: number
  rawBankType: string            // Credit/Debit, Payment/Purchase, etc.
  rawBankCategory: string        // bank's own category label
}

interface ReviewTxn {
  id: string
  date: string
  description: string
  amount: number
  // editable
  type: 'income' | 'expense' | 'transfer'
  categoryId: string | null
  categoryName: string
  isRecurring: boolean
  recurringPeriod: string | null
  // AI metadata (read-only display)
  confidence: number
  reasoning: string
  // source
  accountId: string
  fileId: string
  fileName: string
  // transfer reconciliation
  pairId?: string
}

// ── CSV Parsing ───────────────────────────────────────────────────────────────

function detectFormat(headers: string[]): CsvFormat | null {
  if (headers.includes('Account Number') && headers.includes('Transaction Type')) return 'checking'
  if (headers.includes('Merchant') && headers.includes('Purchased By')) return 'apple-card'
  if (headers.includes('Card No.') && headers.includes('Debit') && headers.includes('Credit')) return 'capital-one-card'
  return null
}

function parseDate(raw: string, format: CsvFormat): string {
  if (!raw) return ''
  if (format === 'checking') {
    // MM/DD/YY → YYYY-MM-DD
    const [m, d, y] = raw.split('/')
    return `20${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  if (format === 'apple-card') {
    // MM/DD/YYYY → YYYY-MM-DD
    const [m, d, y] = raw.split('/')
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // capital-one-card: already YYYY-MM-DD
  return raw
}

function parseRows(rows: Record<string, string>[], format: CsvFormat): ParsedRow[] {
  return rows.map(row => {
    if (format === 'checking') {
      return {
        date: parseDate(row['Transaction Date'] || '', format),
        description: row['Transaction Description'] || '',
        amount: Math.abs(parseFloat(row['Transaction Amount'] || '0')),
        rawBankType: row['Transaction Type'] || '',
        rawBankCategory: '',
      }
    }
    if (format === 'capital-one-card') {
      const debit = parseFloat(row['Debit'] || '0') || 0
      const credit = parseFloat(row['Credit'] || '0') || 0
      return {
        date: parseDate(row['Transaction Date'] || '', format),
        description: row['Description'] || '',
        amount: debit > 0 ? debit : credit,
        rawBankType: credit > 0 ? 'Credit' : 'Debit',
        rawBankCategory: row['Category'] || '',
      }
    }
    // apple-card
    const raw = parseFloat(row['Amount (USD)'] || row['Amount'] || '0')
    return {
      date: parseDate(row['Transaction Date'] || '', format),
      description: row['Merchant'] || row['Description'] || '',
      amount: Math.abs(raw),
      rawBankType: row['Type'] || '',
      rawBankCategory: row['Category'] || '',
    }
  }).filter(r => r.date && r.amount > 0)
}

// ── Transfer Pair Detection ───────────────────────────────────────────────────

function detectTransferPairs(txns: ReviewTxn[]): ReviewTxn[] {
  const result = txns.map(t => ({ ...t, pairId: undefined as string | undefined }))
  const usedIds = new Set<string>()

  for (let i = 0; i < result.length; i++) {
    if (usedIds.has(result[i].id)) continue
    if (result[i].type !== 'transfer') continue

    for (let j = i + 1; j < result.length; j++) {
      if (usedIds.has(result[j].id)) continue
      if (result[j].type !== 'transfer') continue
      if (result[i].accountId === result[j].accountId) continue

      const amountMatch = Math.abs(result[i].amount - result[j].amount) < 0.02
      if (amountMatch) {
        result[i].pairId = result[j].id
        result[j].pairId = result[i].id
        usedIds.add(result[i].id)
        usedIds.add(result[j].id)
        break
      }
    }
  }
  return result
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ToastBanner({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
      {toast.message}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100"><X className="w-3.5 h-3.5" /></button>
    </div>
  )
}

function ConfidenceDot({ value }: { value: number }) {
  const color = value >= 0.85 ? 'bg-emerald-500' : value >= 0.65 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
      <span className="text-xs text-gray-400">{Math.round(value * 100)}%</span>
    </div>
  )
}

function TypeToggle({ value, onChange }: { value: ReviewTxn['type']; onChange: (t: ReviewTxn['type']) => void }) {
  const opts: { key: ReviewTxn['type']; label: string }[] = [
    { key: 'income', label: 'Income' },
    { key: 'expense', label: 'Expense' },
    { key: 'transfer', label: 'Transfer' },
  ]
  return (
    <div className="flex gap-0.5">
      {opts.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`text-xs px-2 py-1 rounded transition-colors ${value === o.key ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<Toast | null>(null)
  const [filters, setFilters] = useState<Filters>({ account: '', category: '', type: '', search: '' })
  const [showAddModal, setShowAddModal] = useState(false)
  const [newTxn, setNewTxn] = useState({
    date: new Date().toISOString().split('T')[0],
    description: '', amount: '', type: 'expense', account_id: '', category_id: '', notes: ''
  })
  const [aiQuestion, setAiQuestion] = useState('')
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  // ── Import State ──────────────────────────────────────────────────────────
  const [importStep, setImportStep] = useState<ImportStep>('idle')
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [reviewTxns, setReviewTxns] = useState<ReviewTxn[]>([])
  const [classifyProgress, setClassifyProgress] = useState('')
  const [reviewFilter, setReviewFilter] = useState<'all' | 'income' | 'expense' | 'transfer'>('all')
  const [saving, setSaving] = useState(false)
  const [addingFile, setAddingFile] = useState(false)

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const [{ data: txns }, { data: accts }, { data: cats }] = await Promise.all([
      supabase.from('transactions').select('*, account:accounts(id,name,type), category:categories(id,name,color)').eq('user_id', user.id).order('date', { ascending: false }).limit(300),
      supabase.from('accounts').select('*').eq('user_id', user.id).eq('is_active', true),
      supabase.from('categories').select('*').eq('user_id', user.id).order('name'),
    ])
    setTransactions(txns || [])
    setAccounts(accts || [])
    setCategories(cats || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { load() }, [load])

  // ── File Upload Handler ───────────────────────────────────────────────────

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    processNewFile(file)
    e.target.value = ''
  }

  function processNewFile(file: File) {
    setAddingFile(true)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as Record<string, string>[]
        const headers = results.meta.fields || []
        const format = detectFormat(headers)

        if (!format) {
          showToast('Unrecognized CSV format — check it is from Capital One or Apple Card', 'error')
          setAddingFile(false)
          return
        }

        const parsed = parseRows(rows, format)
        if (parsed.length === 0) {
          showToast('No valid transactions found in this file', 'error')
          setAddingFile(false)
          return
        }

        // For capital-one-card, detect which card numbers appear
        const detectedCards = format === 'capital-one-card'
          ? [...new Set(rows.map(r => r['Card No.'] || '').filter(Boolean))]
          : []

        // Suggest an account based on format + card numbers
        const suggestedAccount = suggestAccount(format, detectedCards)

        const newFile: PendingFile = {
          fileId: crypto.randomUUID(),
          fileName: file.name,
          format,
          detectedCards,
          accountId: suggestedAccount,
          parsedRows: parsed,
        }

        setPendingFiles(prev => [...prev, newFile])
        setImportStep('select')
        setAddingFile(false)
      },
      error: () => {
        showToast('Could not read file — make sure it is a CSV', 'error')
        setAddingFile(false)
      }
    })
  }

  function suggestAccount(format: CsvFormat, detectedCards: string[]): string {
    if (format === 'apple-card') {
      return accounts.find(a => a.name?.toLowerCase().includes('apple'))?.id || ''
    }
    if (format === 'checking') {
      return accounts.find(a => a.type === 'checking' || a.name?.toLowerCase().includes('checking') || a.name?.toLowerCase().includes('5398'))?.id || ''
    }
    // capital-one-card — try to match by card number
    if (detectedCards.includes('0017')) {
      return accounts.find(a => a.name?.toLowerCase().includes('savor') || a.name?.toLowerCase().includes('0017'))?.id || ''
    }
    if (detectedCards.some(c => ['9043', '1555'].includes(c))) {
      return accounts.find(a => a.name?.toLowerCase().includes('quicksilver') || a.name?.toLowerCase().includes('quick'))?.id || ''
    }
    return accounts.find(a => a.type === 'credit')?.id || ''
  }

  function updateFileAccount(fileId: string, accountId: string) {
    setPendingFiles(prev => prev.map(f => f.fileId === fileId ? { ...f, accountId } : f))
  }

  function removeFile(fileId: string) {
    setPendingFiles(prev => {
      const next = prev.filter(f => f.fileId !== fileId)
      if (next.length === 0) setImportStep('idle')
      return next
    })
  }

  // ── AI Classification ─────────────────────────────────────────────────────

  async function runClassification() {
    if (pendingFiles.some(f => !f.accountId)) {
      showToast('Please map every file to an account before analyzing', 'error')
      return
    }

    setImportStep('classifying')
    const categoryNames = categories.map(c => c.name)
    const catNameToId: Record<string, string> = {}
    categories.forEach(c => { catNameToId[c.name.toLowerCase()] = c.id })

    // Build flat list of transactions to classify
    const toClassify: { id: string; description: string; amount: number; rawBankType: string; rawBankCategory: string; csvFormat: string }[] = []
    const idToFileMeta: Record<string, { fileId: string; fileName: string; accountId: string; row: ParsedRow }> = {}

    pendingFiles.forEach(pf => {
      pf.parsedRows.forEach(row => {
        const id = crypto.randomUUID()
        toClassify.push({
          id,
          description: row.description,
          amount: row.amount,
          rawBankType: row.rawBankType,
          rawBankCategory: row.rawBankCategory,
          csvFormat: pf.format,
        })
        idToFileMeta[id] = { fileId: pf.fileId, fileName: pf.fileName, accountId: pf.accountId, row }
      })
    })

    setClassifyProgress(`Classifying ${toClassify.length} transactions...`)

    try {
      const res = await fetch('/api/classify-transaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: toClassify, categories: categoryNames }),
      })
      const { classified, error } = await res.json()

      if (error || !classified) {
        showToast('AI classification failed — you can still review and edit manually', 'error')
      }

      const classifiedMap: Record<string, any> = {}
      ;(classified || []).forEach((c: any) => { classifiedMap[c.id] = c })

      const reviewRows: ReviewTxn[] = toClassify.map(t => {
        const ai = classifiedMap[t.id] || {}
        const meta = idToFileMeta[t.id]
        const catName = ai.category || ''
        const catId = catNameToId[catName.toLowerCase()] || null

        return {
          id: t.id,
          date: meta.row.date,
          description: t.description,
          amount: t.amount,
          type: ai.type || 'expense',
          categoryId: catId,
          categoryName: catName,
          isRecurring: ai.isRecurring || false,
          recurringPeriod: ai.recurringPeriod || null,
          confidence: ai.confidence ?? 0.5,
          reasoning: ai.reasoning || '',
          accountId: meta.accountId,
          fileId: meta.fileId,
          fileName: meta.fileName,
        }
      })

      // Detect transfer pairs across accounts
      const withPairs = detectTransferPairs(reviewRows)

      setReviewTxns(withPairs)
      setImportStep('review')
      setClassifyProgress('')
    } catch (err) {
      console.error(err)
      showToast('Classification request failed', 'error')
      setImportStep('select')
      setClassifyProgress('')
    }
  }

  // ── Review Editing ────────────────────────────────────────────────────────

  function updateReviewTxn(id: string, patch: Partial<ReviewTxn>) {
    setReviewTxns(prev => {
      const updated = prev.map(t => {
        if (t.id !== id) return t
        const next = { ...t, ...patch }
        // If type changed, clear category if switching to/from transfer
        if (patch.type && patch.type !== t.type) {
          if (patch.type === 'transfer') next.categoryId = null
        }
        return next
      })
      // Re-run pair detection if types changed
      if ('type' in patch) return detectTransferPairs(updated)
      return updated
    })
  }

  // ── Import to DB ─────────────────────────────────────────────────────────

  async function confirmImport() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Fetch existing transactions to check for duplicates
    const { data: existing } = await supabase
      .from('transactions')
      .select('date, description, amount')
      .eq('user_id', user.id)

    const existingSet = new Set(
      (existing || []).map((t: any) => `${t.date}|${t.description}|${t.amount}`)
    )

    const toInsert = reviewTxns
      .filter(t => !existingSet.has(`${t.date}|${t.description}|${t.amount}`))
      .map(t => ({
        user_id: user.id,
        date: t.date,
        description: t.description,
        amount: t.amount,
        type: t.type,
        account_id: t.accountId || null,
        category_id: t.categoryId || null,
        is_recurring: t.isRecurring,
        recurring_period: t.recurringPeriod || null,
      }))

    const skipped = reviewTxns.length - toInsert.length

    if (toInsert.length === 0) {
      showToast('All transactions already exist — nothing imported', 'error')
      setSaving(false)
      return
    }

    const { error } = await supabase.from('transactions').insert(toInsert)
    if (error) {
      showToast(`Import failed: ${error.message}`, 'error')
    } else {
      showToast(`Imported ${toInsert.length} transactions${skipped > 0 ? ` · ${skipped} duplicates skipped` : ''}`)
      resetImport()
      load()
    }
    setSaving(false)
  }

  function resetImport() {
    setImportStep('idle')
    setPendingFiles([])
    setReviewTxns([])
    setReviewFilter('all')
    setClassifyProgress('')
  }

  // ── Add Transaction ───────────────────────────────────────────────────────

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
    } catch { setAiAnswer('Sorry, could not process that question.') }
    setAiLoading(false)
  }

  // ── Derived Data ──────────────────────────────────────────────────────────

  const filtered = transactions.filter(t => {
    if (filters.account && t.account_id !== filters.account) return false
    if (filters.category && t.category_id !== filters.category) return false
    if (filters.type && t.type !== filters.type) return false
    if (filters.search && !t.description.toLowerCase().includes(filters.search.toLowerCase())) return false
    return true
  })

  const reviewVisible = reviewFilter === 'all' ? reviewTxns : reviewTxns.filter(t => t.type === reviewFilter)
  const reviewPairIds = new Set(reviewTxns.filter(t => t.pairId).flatMap(t => [t.id, t.pairId!]))
  const lowConfCount = reviewTxns.filter(t => t.confidence < 0.65).length
  const pairCount = reviewTxns.filter(t => t.pairId).length / 2

  const reviewIncome = reviewTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const reviewExpense = reviewTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
  const reviewTransfer = reviewTxns.filter(t => t.type === 'transfer').reduce((s, t) => s + t.amount, 0)

  // ── Render ────────────────────────────────────────────────────────────────

  const isModalOpen = importStep !== 'idle'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Transactions</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} transactions{(filters.search || filters.account || filters.category || filters.type) ? ' (filtered)' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => { setImportStep('select') }}><Upload className="w-4 h-4" />Import CSV</button>
          <button className="btn-primary" onClick={() => setShowAddModal(true)}><Plus className="w-4 h-4" />Add</button>
        </div>
      </div>

      {/* AI Search */}
      <div className="card">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-500" />
            <input
              className="input pl-9"
              placeholder='Ask anything — "how much did I spend on dining?" or "what are my recurring subscriptions?"'
              value={aiQuestion}
              onChange={e => setAiQuestion(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') askAI() }}
            />
          </div>
          <button className="btn-primary" onClick={askAI} disabled={aiLoading}>{aiLoading ? 'Thinking...' : 'Ask'}</button>
        </div>
        {aiAnswer && (
          <div className="mt-3 p-3 bg-brand-50 border border-brand-100 rounded-lg text-sm text-gray-700 leading-relaxed">{aiAnswer}</div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input className="input pl-8" placeholder="Search..." value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
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
          <option value="transfer">Transfer</option>
        </select>
        {(filters.search || filters.account || filters.category || filters.type) && (
          <button className="btn-ghost text-xs" onClick={() => setFilters({ account: '', category: '', type: '', search: '' })}><X className="w-3.5 h-3.5" />Clear</button>
        )}
      </div>

      {/* Transaction Table */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 font-medium mb-1">No transactions yet</p>
            <p className="text-sm text-gray-400 mb-4">Import a CSV from Capital One or Apple Card to get started</p>
            <button className="btn-primary" onClick={() => setImportStep('select')}><Upload className="w-4 h-4" />Import CSV</button>
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
                    <td className="px-4 py-2.5 text-gray-800 font-medium max-w-[200px] truncate">
                      {t.description}
                      {(t as any).is_recurring && <span className="ml-1.5 text-[10px] text-brand-500 bg-brand-50 border border-brand-100 rounded px-1 py-0.5">recurring</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <select className="text-xs border-0 bg-transparent p-0 pr-4 focus:ring-0 focus:outline-none text-gray-600 cursor-pointer appearance-none max-w-[140px]"
                        value={t.category_id || ''} onChange={e => updateCategory(t.id, e.target.value)}>
                        <option value="">Uncategorized</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400 hidden md:table-cell">{(t.account as any)?.name || '—'}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${t.type === 'income' ? 'text-emerald-600' : t.type === 'transfer' ? 'text-gray-400' : 'text-gray-800'}`}>
                      {t.type === 'income' ? '+' : t.type === 'transfer' ? '⇄ ' : ''}{formatCurrency(t.amount)}
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
              <span className="font-semibold text-gray-700">
                Net: <span className={filtered.reduce((s, t) => t.type === 'income' ? s + t.amount : s - t.amount, 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                  {formatCurrency(Math.abs(filtered.reduce((s, t) => t.type === 'income' ? s + t.amount : s - t.amount, 0)))}
                </span>
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Import Modal ─────────────────────────────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl my-8">

            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-gray-900 text-lg">Import Transactions</h2>
                {/* Step indicator */}
                <div className="hidden sm:flex items-center gap-1 text-xs text-gray-400">
                  {['Select files', 'Analyze', 'Review & confirm'].map((step, i) => {
                    const stepKeys: ImportStep[] = ['select', 'classifying', 'review']
                    const idx = stepKeys.indexOf(importStep)
                    const done = i < idx
                    const active = i === idx
                    return (
                      <span key={step} className="flex items-center gap-1">
                        {i > 0 && <span className="text-gray-200">›</span>}
                        <span className={`${active ? 'text-gray-800 font-medium' : done ? 'text-emerald-600' : 'text-gray-300'}`}>
                          {done ? '✓ ' : ''}{step}
                        </span>
                      </span>
                    )
                  })}
                </div>
              </div>
              {importStep !== 'classifying' && !saving && (
                <button onClick={resetImport} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
              )}
            </div>

            {/* ── Step: Select files ─────────────────────────────────────── */}
            {(importStep === 'select') && (
              <div className="p-6 space-y-5">
                {/* Uploaded files list */}
                {pendingFiles.length > 0 && (
                  <div className="space-y-3">
                    {pendingFiles.map(pf => (
                      <div key={pf.fileId} className="flex items-center gap-3 p-3 border border-gray-100 rounded-xl bg-gray-50">
                        <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-700 truncate">{pf.fileName}</p>
                          <p className="text-xs text-gray-400">
                            {pf.format === 'checking' ? 'Capital One Checking' : pf.format === 'apple-card' ? 'Apple Card' : `Capital One card${pf.detectedCards.length ? ` (${pf.detectedCards.join(', ')})` : ''}`}
                            {' · '}{pf.parsedRows.length} transactions
                          </p>
                        </div>
                        <select
                          className="input text-sm w-52 flex-shrink-0"
                          value={pf.accountId}
                          onChange={e => updateFileAccount(pf.fileId, e.target.value)}
                        >
                          <option value="">Select account...</option>
                          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                        <button onClick={() => removeFile(pf.fileId)} className="text-gray-300 hover:text-red-400 flex-shrink-0"><X className="w-4 h-4" /></button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Drop zone */}
                <div
                  className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center hover:border-gray-300 transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) processNewFile(f) }}
                >
                  {addingFile ? (
                    <div className="flex flex-col items-center gap-2">
                      <RefreshCw className="w-6 h-6 text-gray-400 animate-spin" />
                      <p className="text-sm text-gray-500">Reading file...</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="w-6 h-6 text-gray-300" />
                      <p className="text-sm font-medium text-gray-500">{pendingFiles.length > 0 ? 'Add another CSV' : 'Drop CSV here or click to upload'}</p>
                      <p className="text-xs text-gray-400">Capital One Checking · Quicksilver · Savor · Apple Card</p>
                    </div>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileInput} />

                {/* Format guide */}
                <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="font-medium text-gray-600 mb-1">Capital One Checking / Cards</p>
                    <p>Account → Transactions → Download → CSV</p>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="font-medium text-gray-600 mb-1">Apple Card</p>
                    <p>Wallet app → Apple Card → tap month → Export Transactions</p>
                  </div>
                </div>

                {pendingFiles.length > 0 && (
                  <div className="flex justify-between items-center pt-2">
                    <p className="text-sm text-gray-500">
                      {pendingFiles.reduce((s, f) => s + f.parsedRows.length, 0)} total transactions across {pendingFiles.length} file{pendingFiles.length > 1 ? 's' : ''}
                    </p>
                    <button
                      className="btn-primary"
                      onClick={runClassification}
                      disabled={pendingFiles.some(f => !f.accountId)}
                    >
                      <Sparkles className="w-4 h-4" />
                      Analyze with AI
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Step: Classifying ──────────────────────────────────────── */}
            {importStep === 'classifying' && (
              <div className="p-12 text-center">
                <Sparkles className="w-10 h-10 text-brand-500 mx-auto mb-4 animate-pulse" />
                <p className="font-medium text-gray-800 mb-2">AI is analyzing your transactions</p>
                <p className="text-sm text-gray-500">{classifyProgress}</p>
                <p className="text-xs text-gray-400 mt-2">Classifying type, category, and recurring status for each transaction...</p>
              </div>
            )}

            {/* ── Step: Review ───────────────────────────────────────────── */}
            {importStep === 'review' && (
              <div className="flex flex-col">

                {/* Alerts */}
                <div className="px-6 pt-4 space-y-2">
                  {pairCount > 0 && (
                    <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                      <span className="font-medium">⇄ {pairCount} transfer pair{pairCount > 1 ? 's' : ''} detected</span>
                      <span className="text-amber-600">— credit card payments matched between accounts. Both sides are marked as transfer and excluded from totals.</span>
                    </div>
                  )}
                  {lowConfCount > 0 && (
                    <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span><strong>{lowConfCount} transactions</strong> had low AI confidence — flagged for your review.</span>
                    </div>
                  )}
                </div>

                {/* Filter tabs */}
                <div className="flex items-center gap-1 px-6 pt-3 pb-2">
                  {(['all', 'income', 'expense', 'transfer'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setReviewFilter(f)}
                      className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${reviewFilter === f ? 'bg-gray-100 text-gray-800 font-medium' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                      <span className="ml-1 text-gray-400 font-normal">
                        {f === 'all' ? reviewTxns.length : reviewTxns.filter(t => t.type === f).length}
                      </span>
                    </button>
                  ))}
                  <span className="flex-1" />
                  <button onClick={() => setImportStep('select')} className="text-xs text-gray-400 hover:text-gray-600">← Edit files</button>
                </div>

                {/* Review table */}
                <div className="overflow-x-auto border-y border-gray-100 max-h-[50vh] overflow-y-auto">
                  <table className="w-full text-sm min-w-[820px]">
                    <thead className="sticky top-0 bg-gray-50 border-b border-gray-100 z-10">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs w-20">Date</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-500 text-xs">Description</th>
                        <th className="text-right px-4 py-2.5 font-medium text-gray-500 text-xs w-24">Amount</th>
                        <th className="px-4 py-2.5 font-medium text-gray-500 text-xs w-52">Type</th>
                        <th className="px-4 py-2.5 font-medium text-gray-500 text-xs w-36">Category</th>
                        <th className="px-4 py-2.5 font-medium text-gray-500 text-xs w-20 text-center">Recurring</th>
                        <th className="px-4 py-2.5 font-medium text-gray-500 text-xs w-20">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewVisible.map(t => {
                        const isPaired = !!t.pairId
                        const isLow = t.confidence < 0.65
                        const rowClass = isPaired ? 'bg-amber-50/50' : isLow ? 'bg-red-50/50' : ''

                        return (
                          <tr key={t.id} className={`border-b border-gray-50 ${rowClass}`}>
                            <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">{t.date}</td>
                            <td className="px-4 py-2 max-w-[220px]">
                              <p className="text-gray-800 text-xs font-medium truncate">{t.description}</p>
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className="text-[10px] text-gray-400">{accounts.find(a => a.id === t.accountId)?.name || t.fileName}</span>
                                {isPaired && <span className="text-[10px] text-amber-600 bg-amber-100 rounded px-1">⇄ paired</span>}
                                {isLow && <span className="text-[10px] text-red-500 bg-red-50 rounded px-1">review</span>}
                              </div>
                            </td>
                            <td className={`px-4 py-2 text-right text-xs font-semibold tabular-nums ${t.type === 'income' ? 'text-emerald-600' : t.type === 'transfer' ? 'text-gray-400' : 'text-gray-700'}`}>
                              {t.type === 'income' ? '+' : t.type === 'transfer' ? '⇄ ' : ''}{formatCurrency(t.amount)}
                            </td>
                            <td className="px-4 py-2">
                              <TypeToggle value={t.type} onChange={type => updateReviewTxn(t.id, { type })} />
                            </td>
                            <td className="px-4 py-2">
                              {t.type !== 'transfer' ? (
                                <select
                                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 w-full bg-white focus:outline-none focus:ring-1 focus:ring-brand-300"
                                  value={t.categoryId || ''}
                                  onChange={e => {
                                    const cat = categories.find(c => c.id === e.target.value)
                                    updateReviewTxn(t.id, { categoryId: e.target.value || null, categoryName: cat?.name || '' })
                                  }}
                                >
                                  <option value="">Uncategorized</option>
                                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                              ) : (
                                <span className="text-xs text-gray-300">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={t.isRecurring}
                                onChange={e => updateReviewTxn(t.id, { isRecurring: e.target.checked })}
                                className="rounded border-gray-300 text-brand-500 focus:ring-brand-400"
                              />
                              {t.isRecurring && t.recurringPeriod && (
                                <p className="text-[10px] text-gray-400 mt-0.5">{t.recurringPeriod}</p>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <ConfidenceDot value={t.confidence} />
                              {t.reasoning && (
                                <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{t.reasoning}</p>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Summary footer */}
                <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-6 text-sm">
                      <div>
                        <span className="text-gray-400 text-xs">Income</span>
                        <p className="font-semibold text-emerald-600">+{formatCurrency(reviewIncome)}</p>
                      </div>
                      <div>
                        <span className="text-gray-400 text-xs">Expenses</span>
                        <p className="font-semibold text-gray-800">-{formatCurrency(reviewExpense)}</p>
                      </div>
                      <div>
                        <span className="text-gray-400 text-xs">Transfers (excluded)</span>
                        <p className="font-semibold text-gray-400">{formatCurrency(reviewTransfer)}</p>
                      </div>
                      <div>
                        <span className="text-gray-400 text-xs">Net</span>
                        <p className={`font-semibold ${reviewIncome - reviewExpense >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                          {formatCurrency(Math.abs(reviewIncome - reviewExpense))}
                        </p>
                      </div>
                    </div>
                    <button
                      className="btn-primary"
                      onClick={confirmImport}
                      disabled={saving}
                    >
                      {saving ? (
                        <><RefreshCw className="w-4 h-4 animate-spin" />Saving...</>
                      ) : (
                        <><CheckCircle className="w-4 h-4" />Import {reviewTxns.length} transactions</>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Add Transaction Modal ─────────────────────────────────────────── */}
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
