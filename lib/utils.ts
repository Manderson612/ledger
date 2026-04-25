import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, addDays, isAfter, isBefore, startOfMonth, endOfMonth } from 'date-fns'
import type { IncomeSettings, PaycheckEvent } from './types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, showSign = false): string {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))

  if (showSign && amount > 0) return `+${formatted}`
  if (amount < 0) return `-${formatted}`
  return formatted
}

export function formatDate(date: string | Date): string {
  return format(new Date(date), 'MMM d, yyyy')
}

export function formatMonth(date: string | Date): string {
  return format(new Date(date), 'MMMM yyyy')
}

export function getFirstOfMonth(date?: Date): string {
  const d = date || new Date()
  return format(startOfMonth(d), 'yyyy-MM-dd')
}

// Calculate all paycheck dates for a given month
export function getPaychecksForMonth(
  settings: IncomeSettings,
  month: Date
): PaycheckEvent[] {
  const events: PaycheckEvent[] = []
  const monthStart = startOfMonth(month)
  const monthEnd = endOfMonth(month)

  if (settings.pay_schedule === 'semi-monthly') {
    const day1 = settings.pay_day_1 || 7
    const day2 = settings.pay_day_2 || 22

    const date1 = new Date(month.getFullYear(), month.getMonth(), day1)
    const date2 = new Date(month.getFullYear(), month.getMonth(), day2)

    const net = settings.net_per_paycheck || 0
    const commission = settings.avg_monthly_commission || 0

    if (!isBefore(date1, monthStart) && !isAfter(date1, monthEnd)) {
      events.push({
        date: format(date1, 'yyyy-MM-dd'),
        person: settings.display_name,
        amount: net,
        hasCommission: settings.commission_on_paycheck === 1,
        label: `${settings.display_name} — Salary${settings.commission_on_paycheck === 1 ? ' + Commission' : ''}`,
      })
    }

    if (!isBefore(date2, monthStart) && !isAfter(date2, monthEnd)) {
      const payAmount = settings.commission_on_paycheck === 2 ? net + commission : net
      events.push({
        date: format(date2, 'yyyy-MM-dd'),
        person: settings.display_name,
        amount: payAmount,
        hasCommission: settings.commission_on_paycheck === 2,
        label: `${settings.display_name} — Salary${settings.commission_on_paycheck === 2 ? ' + Commission' : ''}`,
      })
    }
  }

  if (settings.pay_schedule === 'bi-weekly' && settings.last_paycheck_date) {
    const anchor = new Date(settings.last_paycheck_date)
    let current = new Date(anchor)

    // Walk backwards to find first paycheck in or before the month
    while (isAfter(current, monthEnd)) {
      current = addDays(current, -14)
    }
    while (isBefore(current, monthStart)) {
      current = addDays(current, 14)
    }

    while (!isAfter(current, monthEnd)) {
      if (!isBefore(current, monthStart)) {
        events.push({
          date: format(current, 'yyyy-MM-dd'),
          person: settings.display_name,
          amount: settings.net_per_paycheck || 0,
          hasCommission: false,
          label: `${settings.display_name} — Paycheck`,
        })
      }
      current = addDays(current, 14)
    }
  }

  return events.sort((a, b) => a.date.localeCompare(b.date))
}

export function percentOf(value: number, total: number): number {
  if (total === 0) return 0
  return Math.round((value / total) * 100)
}
