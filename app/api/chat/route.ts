// app/api/chat/route.ts
import { createServerClient } from '@/lib/supabase'
import { embedText, generateResponse } from '@/lib/gemini'
import { isAggregativeQuery, parseDataBlock, stripDataBlock } from '@/lib/chat'
import type { DataBlock } from '@/lib/chat'

const SYSTEM_PROMPT = `You are a financial assistant for InvoiceBrain, a personal invoice management tool.
Answer questions concisely based on the invoice data provided as context.
If your answer includes specific amounts or a vendor breakdown, end your response with a JSON block in exactly this format:
<data>{"items":[{"vendor":"string","amount":0.00,"currency":"string"}],"total":0.00,"currency":"string"}</data>
Only include <data> when the answer contains specific figures. Omit it for general or qualitative answers.`

type InvoiceContext = {
  vendor_name: string | null
  invoice_date: string | null
  invoice_number: string | null
  amount: number | null
  tax: number | null
  currency: string | null
  raw_text: string | null
  similarity: number
}

type CurrencyAggregate = {
  currency: string
  sum: number
  count: number
}

export async function POST(request: Request) {
  const { message } = await request.json() as { message: string }

  if (!message?.trim()) {
    return Response.json({ error: 'Message is required' }, { status: 400 })
  }

  const supabase = createServerClient()

  // 1. Embed the question
  const embedding = await embedText(message)
  const embeddingString = `[${embedding.join(',')}]`

  // 2. Vector similarity search against approved invoices
  const { data: similar, error: searchError } = await supabase.rpc('search_invoices', {
    query_embedding: embeddingString,
    match_count: 5,
  })

  if (searchError) {
    return Response.json({ error: 'Search failed' }, { status: 500 })
  }

  const invoices = (similar as InvoiceContext[]) ?? []

  // 3. SQL aggregate if question appears aggregative
  let aggregateContext = ''
  if (isAggregativeQuery(message)) {
    const { data: agg } = await supabase
      .from('invoices')
      .select('currency, amount')
      .eq('status', 'approved')

    if (agg && agg.length > 0) {
      const byCurrency = (agg as { currency: string; amount: number }[]).reduce<
        Record<string, CurrencyAggregate>
      >((acc, row) => {
        const cur = row.currency ?? 'UNKNOWN'
        if (!acc[cur]) acc[cur] = { currency: cur, sum: 0, count: 0 }
        acc[cur].sum += Number(row.amount ?? 0)
        acc[cur].count += 1
        return acc
      }, {})

      const lines = Object.values(byCurrency)
        .map(c => `${c.currency}: ${c.sum.toFixed(2)} (${c.count} invoices)`)
        .join('\n')

      aggregateContext = `\n\nGlobal approved invoice totals by currency:\n${lines}`
    }
  }

  // 4. Build prompt
  const invoiceContext =
    invoices.length > 0
      ? invoices
          .map(
            inv =>
              `Vendor: ${inv.vendor_name ?? 'Unknown'} | Date: ${inv.invoice_date ?? 'Unknown'} | ` +
              `Invoice#: ${inv.invoice_number ?? 'N/A'} | Amount: ${inv.amount ?? 0} ${inv.currency ?? ''} | ` +
              `Tax: ${inv.tax ?? 0} | Similarity: ${inv.similarity.toFixed(3)}`
          )
          .join('\n')
      : 'No matching invoices found.'

  const prompt = `${SYSTEM_PROMPT}

Relevant invoices:
${invoiceContext}${aggregateContext}

User question: ${message}`

  // 5. Generate response
  const rawResponse = await generateResponse(prompt)
  const data: DataBlock | null = parseDataBlock(rawResponse)
  const text = stripDataBlock(rawResponse)

  return Response.json({ text, data })
}
