// app/api/chat/route.ts
import { createServerClient } from '@/lib/supabase'
import { embedText, generateResponse } from '@/lib/gemini'
import {
  isAggregativeQuery,
  parseDataBlock,
  stripDataBlock,
  buildPrompt,
} from '@/lib/chat'
import type { DataBlock, InvoiceContext, ConversationMessage } from '@/lib/chat'

const SYSTEM_PROMPT = `You are a financial assistant for InvoiceBrain, a personal invoice management tool.
Answer questions concisely based on the invoice data provided as context.
If your answer includes specific amounts or a vendor breakdown, end your response with a JSON block in exactly this format:
<data>{"items":[{"vendor":"string","amount":0.00,"currency":"string"}],"total":0.00,"currency":"string"}</data>
Only include <data> when the answer contains specific figures. Omit it for general or qualitative answers.`

type CurrencyAggregate = {
  currency: string
  sum: number
  count: number
}

export async function POST(request: Request) {
  let message: string
  let history: ConversationMessage[]
  try {
    const body = await request.json() as { message?: string; history?: ConversationMessage[] }
    message = body.message ?? ''
    history = body.history ?? []
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!message.trim()) {
    return Response.json({ error: 'Message is required' }, { status: 400 })
  }

  const supabase = createServerClient()

  // 1. Embed the question
  let embedding: number[]
  try {
    embedding = await embedText(message)
  } catch {
    return Response.json({ error: 'Embedding failed' }, { status: 500 })
  }
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

      aggregateContext = Object.values(byCurrency)
        .map(c => `${c.currency}: ${c.sum.toFixed(2)} (${c.count} invoices)`)
        .join('\n')
    }
  }

  // 4. Build prompt (includes history for multi-turn context)
  const prompt = buildPrompt(SYSTEM_PROMPT, message, invoices, aggregateContext, history)

  // 5. Generate response
  let rawResponse: string
  try {
    rawResponse = await generateResponse(prompt)
  } catch {
    return Response.json({ error: 'Generation failed' }, { status: 500 })
  }
  const data: DataBlock | null = parseDataBlock(rawResponse)
  const text = stripDataBlock(rawResponse)

  return Response.json({ text, data })
}
