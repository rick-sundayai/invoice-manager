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
