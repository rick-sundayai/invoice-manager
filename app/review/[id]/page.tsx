// app/review/[id]/page.tsx
import { redirect, notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Invoice } from '@/types/invoice'

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .eq('status', 'pending')
    .single()

  if (error || !data) {
    notFound()
  }

  const invoice = data as Invoice

  async function updateAndApprove(formData: FormData) {
    'use server'
    const supabase = createServerClient()
    await supabase
      .from('invoices')
      .update({
        vendor_name: formData.get('vendor_name') as string,
        invoice_number: formData.get('invoice_number') as string,
        invoice_date: formData.get('invoice_date') as string || null,
        amount: parseFloat(formData.get('amount') as string) || null,
        tax: parseFloat(formData.get('tax') as string) || null,
        currency: (formData.get('currency') as string | null)?.toUpperCase() || null,
        status: 'approved',
      })
      .eq('id', id)

    redirect('/review')
  }

  return (
    <div className="p-8 max-w-lg">
      <div className="mb-6">
        <a href="/review" className="text-sm text-blue-600 hover:underline">← Back to inbox</a>
        <h1 className="text-2xl font-bold text-slate-900 mt-2">Edit Invoice</h1>
        <p className="text-sm text-slate-500 mt-1">Correct any fields then approve.</p>
      </div>

      <form action={updateAndApprove} className="flex flex-col gap-4 bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vendor_name">Vendor</Label>
          <Input id="vendor_name" name="vendor_name" defaultValue={invoice.vendor_name ?? ''} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invoice_number">Invoice Number</Label>
          <Input id="invoice_number" name="invoice_number" defaultValue={invoice.invoice_number ?? ''} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invoice_date">Date</Label>
          <Input id="invoice_date" name="invoice_date" type="date" defaultValue={invoice.invoice_date ?? ''} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="amount">Amount</Label>
            <Input id="amount" name="amount" type="number" step="0.01" defaultValue={invoice.amount ?? ''} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tax">Tax</Label>
            <Input id="tax" name="tax" type="number" step="0.01" defaultValue={invoice.tax ?? ''} />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="currency">Currency (3-letter code)</Label>
          <Input id="currency" name="currency" maxLength={3} defaultValue={invoice.currency ?? ''} placeholder="EUR" />
        </div>

        <Button type="submit" className="bg-green-600 hover:bg-green-700 text-white mt-2">
          Save & Approve
        </Button>
      </form>
    </div>
  )
}
