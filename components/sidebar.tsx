// components/sidebar.tsx
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'

type SidebarProps = {
  pendingCount: number
}

export function Sidebar({ pendingCount }: SidebarProps) {
  return (
    <aside className="w-56 shrink-0 bg-slate-900 flex flex-col h-full">
      <div className="px-4 py-5">
        <span className="text-white font-bold text-base tracking-tight">
          InvoiceBrain
        </span>
      </div>

      <nav className="flex flex-col gap-1 px-2">
        <Link
          href="/review"
          className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <span className="flex items-center gap-2">
            <span>📋</span>
            Review
          </span>
          {pendingCount > 0 && (
            <Badge className="bg-blue-600 hover:bg-blue-600 text-white text-xs px-2">
              {pendingCount}
            </Badge>
          )}
        </Link>

        <Link
          href="/chat"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <span>💬</span>
          Chat
        </Link>
      </nav>
    </aside>
  )
}
