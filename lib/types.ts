// ============================================================
// LEDGER — SHARED TYPES
// ============================================================

export type AccountType = 'checking' | 'savings' | 'credit' | 'investment' | 'other'
export type TransactionType = 'income' | 'expense' | 'transfer'
export type PaySchedule = 'semi-monthly' | 'bi-weekly' | 'monthly' | 'weekly'
export type NetWorthItemType = 'asset' | 'liability'
export type NetWorthCategory = 'cash' | 'investment' | 'property' | 'vehicle' | 'retirement' | 'loan' | 'credit' | 'other'

export interface Account {
  id: string
  user_id: string
  name: string
  type: AccountType
  institution?: string
  balance: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Category {
  id: string
  user_id: string
  name: string
  color: string
  is_income: boolean
  created_at: string
}

export interface Transaction {
  id: string
  user_id: string
  account_id?: string
  category_id?: string
  date: string
  description: string
  amount: number
  type: TransactionType
  notes?: string
  created_at: string
  updated_at: string
  // Joined fields
  account?: Account
  category?: Category
}

export interface Budget {
  id: string
  user_id: string
  category_id: string
  month: string
  amount: number
  created_at: string
  // Joined
  category?: Category
  spent?: number
}

export interface Goal {
  id: string
  user_id: string
  name: string
  target_amount: number
  current_amount: number
  target_date?: string
  color: string
  is_complete: boolean
  created_at: string
  updated_at: string
}

export interface Bill {
  id: string
  user_id: string
  name: string
  amount: number
  due_day: number
  category_id?: string
  is_active: boolean
  auto_pay: boolean
  created_at: string
  // Joined
  category?: Category
}

export interface NetWorthItem {
  id: string
  user_id: string
  name: string
  type: NetWorthItemType
  amount: number
  category?: NetWorthCategory
  updated_at: string
  created_at: string
}

export interface NetWorthSnapshot {
  id: string
  user_id: string
  month: string
  total_assets: number
  total_liabilities: number
  net_worth: number
  created_at: string
}

export interface IncomeSettings {
  id: string
  user_id: string
  person: 'primary' | 'partner'
  display_name: string
  annual_salary?: number
  net_per_paycheck?: number
  pay_schedule: PaySchedule
  pay_day_1?: number
  pay_day_2?: number
  last_paycheck_date?: string
  avg_monthly_commission: number
  commission_on_paycheck: number
  created_at: string
  updated_at: string
}

// UI helper types
export interface PaycheckEvent {
  date: string
  person: string
  amount: number
  hasCommission: boolean
  label: string
}

export interface BudgetWithActuals extends Budget {
  spent: number
  remaining: number
  percentUsed: number
  isOver: boolean
}
