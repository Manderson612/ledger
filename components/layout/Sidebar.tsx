'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Calendar,
  ArrowLeftRight,
  PieChart,
  TrendingUp,
  Target,
  Receipt,
  FileBarChart,
  BarChart3,
  Settings,
  TrendingUp as Logo,
  LogOut,
} from 'lucide-react'

const nav = [
  { href: '/dashboard',           label: 'Dashboard',     icon: LayoutDashboard },
  { href: '/dashboard/planner',   label: 'Planner',       icon: Calendar },
  { href: '/dashboard/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/dashboard/budget',    label: 'Budget',        icon: PieChart },
  { href: '/dashboard/analysis',  label: 'Spend Analysis',icon: TrendingUp },
  { href: '/dashboard/goals',     label: 'Goals',         icon: Target },
  { href: '/dashboard/bills',     label: 'Bills',         icon: Receipt },
  { href: '/dashboard/reports',   label: 'Reports',       icon: FileBarChart },
  { href: '/dashboard/net-worth', label: 'Net Worth',     icon: BarChart3 },
  { href: '/dashboard/settings',  label: 'Settings',      icon: Settings },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-[220px] bg-gray-900 flex flex-col z-40">

      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-gray-800">
        <div className="w-7 h-7 bg-brand-500 rounded-md flex items-center justify-center flex-shrink-0">
          <Logo className="w-4 h-4 text-white" />
        </div>
        <span className="text-base font-semibold text-white tracking-tight">Ledger</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-brand-500 text-white font-medium'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Sign out */}
      <div className="px-3 py-4 border-t border-gray-800">
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 w-full transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
