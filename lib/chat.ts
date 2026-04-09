// lib/chat.ts
const AGGREGATIVE_KEYWORDS = ['total', 'sum', 'how much', 'spend', 'spent', 'cost', 'expense']

export function isAggregativeQuery(query: string): boolean {
  const lower = query.toLowerCase()
  return AGGREGATIVE_KEYWORDS.some(keyword => lower.includes(keyword))
}

export type DataBlock = {
  items: Array<{ vendor: string; amount: number; currency: string }>
  total?: number
  currency?: string
}

export type InvoiceContext = {
  vendor_name: string | null
  invoice_date: string | null
  invoice_number: string | null
  amount: number | null
  tax: number | null
  currency: string | null
  raw_text: string | null
  similarity: number
}

export type ConversationMessage = {
  role: 'user' | 'assistant'
  text: string
}

export function parseDataBlock(text: string): DataBlock | null {
  const match = text.match(/<data>([\s\S]*?)<\/data>/)
  if (!match) return null
  try {
    return JSON.parse(match[1]) as DataBlock
  } catch {
    return null
  }
}

export function stripDataBlock(text: string): string {
  return text.replace(/<data>[\s\S]*?<\/data>/, '').trim()
}

export function buildPrompt(
  systemPrompt: string,
  message: string,
  invoices: InvoiceContext[],
  aggregateContext: string,
  history: ConversationMessage[]
): string {
  const parts: string[] = []

  // System prompt
  parts.push(systemPrompt)

  // Relevant invoices section
  parts.push('\nRelevant invoices:')
  if (invoices.length === 0) {
    parts.push('No matching invoices found.')
  } else {
    invoices.forEach(invoice => {
      const line = `Vendor: ${invoice.vendor_name ?? 'Unknown'} | Date: ${invoice.invoice_date ?? 'Unknown'} | Invoice#: ${invoice.invoice_number ?? 'N/A'} | Amount: ${invoice.amount ?? 0} ${invoice.currency ?? ''} | Tax: ${invoice.tax ?? 0} | Similarity: ${invoice.similarity.toFixed(3)}`
      parts.push(line)
    })
  }

  // Global approved invoice totals section (only if aggregateContext is non-empty)
  if (aggregateContext) {
    parts.push('\nGlobal approved invoice totals by currency:')
    parts.push(aggregateContext)
  }

  // Conversation history section (only if history is non-empty)
  if (history.length > 0) {
    parts.push('\nConversation so far:')
    history.forEach(msg => {
      if (msg.role === 'user') {
        parts.push(`User: ${msg.text}`)
      } else {
        parts.push(`Assistant: ${msg.text}`)
      }
    })
  }

  // Current user message
  parts.push(`\nUser: ${message}`)

  return parts.join('\n')
}
