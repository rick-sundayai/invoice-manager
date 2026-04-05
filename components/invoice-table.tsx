'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import type { InvoiceRow } from '@/types/invoice'

type InvoiceTableProps = {
  invoices: InvoiceRow[]
}

export function InvoiceTable({ invoices: initial }: InvoiceTableProps) {
  const router = useRouter()
  const [invoices, setInvoices] = useState(initial)
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set())

  async function approve(id: string) {
    setApprovingIds(prev => new Set(prev).add(id))
    const res = await fetch(`/api/approve/${id}`, { method: 'PATCH' })
    if (res.ok) {
      setInvoices(prev => prev.filter(inv => inv.id !== id))
      router.refresh()
    }
    setApprovingIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  async function approveAll() {
    for (const inv of invoices) {
      await approve(inv.id)
    }
  }

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p className="text-lg font-medium">All caught up</p>
        <p className="text-sm mt-1">No invoices pending review.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">{invoices.length} invoices awaiting approval</p>
        <Button
          size="sm"
          variant="outline"
          onClick={approveAll}
          disabled={approvingIds.size > 0}
        >
          Approve All
        </Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="font-semibold text-slate-600">Vendor</TableHead>
              <TableHead className="font-semibold text-slate-600">Date</TableHead>
              <TableHead className="font-semibold text-slate-600">Amount</TableHead>
              <TableHead className="font-semibold text-slate-600">Tax</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map(inv => (
              <TableRow key={inv.id}>
                <TableCell>
                  <p className="font-semibold text-slate-900">{inv.vendor_name ?? '—'}</p>
                  {inv.invoice_number && (
                    <Link
                      href={`/review/${inv.id}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {inv.invoice_number}
                    </Link>
                  )}
                </TableCell>
                <TableCell className="text-sm text-slate-500">
                  {inv.invoice_date
                    ? new Date(inv.invoice_date).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                    : '—'}
                </TableCell>
                <TableCell>
                  <p className="font-bold text-slate-900">
                    {inv.amount != null ? inv.amount.toFixed(2) : '—'}
                  </p>
                  <p className="text-xs text-slate-400">{inv.currency ?? ''}</p>
                </TableCell>
                <TableCell className="text-sm text-slate-500">
                  {inv.tax != null ? inv.tax.toFixed(2) : '—'}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => approve(inv.id)}
                    disabled={approvingIds.has(inv.id)}
                  >
                    ✓
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
