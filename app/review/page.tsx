import { createServerClient } from '@/lib/supabase'
import { InvoiceTable } from '@/components/invoice-table'
import type { InvoiceRow } from '@/types/invoice'

export default async function ReviewPage() {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('invoices')
    .select('id, status, vendor_name, invoice_date, invoice_number, amount, tax, currency, raw_text, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <div className="p-8 text-red-500">
        Failed to load invoices: {error.message}
      </div>
    )
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Review Inbox</h1>
      <InvoiceTable invoices={(data as InvoiceRow[]) ?? []} />
    </div>
  )
}
