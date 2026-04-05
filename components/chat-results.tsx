// components/chat-results.tsx
import type { DataBlock } from '@/lib/chat'

type ChatResultsProps = {
  data: DataBlock | null
}

export function ChatResults({ data }: ChatResultsProps) {
  if (!data || data.items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-slate-400">No data results</p>
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Results</p>

      {data.items.map((item, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-400">{item.vendor}</p>
          <p className="text-lg font-bold text-blue-700 mt-1">
            {item.amount.toFixed(2)}{' '}
            <span className="text-sm font-normal text-slate-500">{item.currency}</span>
          </p>
        </div>
      ))}

      {data.total != null && (
        <div className="bg-slate-900 rounded-lg p-4">
          <p className="text-xs text-slate-400">Total</p>
          <p className="text-lg font-bold text-white mt-1">
            {data.total.toFixed(2)}{' '}
            <span className="text-sm font-normal text-slate-400">{data.currency ?? ''}</span>
          </p>
        </div>
      )}
    </div>
  )
}
