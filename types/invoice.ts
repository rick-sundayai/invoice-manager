// types/invoice.ts
export type InvoiceStatus = 'pending' | 'approved'

export type Invoice = {
  id: string
  status: InvoiceStatus
  vendor_name: string | null
  invoice_date: string | null  // ISO-8601 date, e.g. "2024-03-15"
  invoice_number: string | null
  amount: number | null
  tax: number | null
  currency: string | null
  raw_text: string | null
  embedding: number[] | null
  created_at: string
}

export type InvoiceRow = Omit<Invoice, 'embedding'>
