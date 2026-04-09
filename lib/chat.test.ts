// lib/chat.test.ts
import { isAggregativeQuery, parseDataBlock, stripDataBlock, buildPrompt } from './chat'
import type { InvoiceContext, ConversationMessage } from './chat'

describe('isAggregativeQuery', () => {
  it('returns true for "total" keyword', () => {
    expect(isAggregativeQuery('What was my total spend?')).toBe(true)
  })

  it('returns true for "sum" keyword', () => {
    expect(isAggregativeQuery('Give me the sum of EUR invoices')).toBe(true)
  })

  it('returns true for "how much" phrase', () => {
    expect(isAggregativeQuery('How much did I spend last month?')).toBe(true)
  })

  it('returns true for "spend" keyword', () => {
    expect(isAggregativeQuery('What did I spend in March?')).toBe(true)
  })

  it('returns false for a semantic question', () => {
    expect(isAggregativeQuery('Which invoices are from AWS?')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isAggregativeQuery('TOTAL spend on software')).toBe(true)
  })
})

describe('parseDataBlock', () => {
  it('returns null when no data block present', () => {
    expect(parseDataBlock('Here is your answer.')).toBeNull()
  })

  it('parses a valid data block', () => {
    const text = 'Your spend was high.\n<data>{"items":[{"vendor":"AWS","amount":100,"currency":"EUR"}],"total":100,"currency":"EUR"}</data>'
    const result = parseDataBlock(text)
    expect(result).toEqual({
      items: [{ vendor: 'AWS', amount: 100, currency: 'EUR' }],
      total: 100,
      currency: 'EUR',
    })
  })

  it('returns null when data block contains invalid JSON', () => {
    const text = 'Answer.\n<data>not json</data>'
    expect(parseDataBlock(text)).toBeNull()
  })
})

describe('stripDataBlock', () => {
  it('removes the data block from text', () => {
    expect(stripDataBlock('Answer.\n<data>{"items":[]}</data>')).toBe('Answer.')
  })

  it('returns text unchanged when no data block present', () => {
    expect(stripDataBlock('No block here.')).toBe('No block here.')
  })
})

describe('buildPrompt', () => {
  const SYSTEM = 'You are a financial assistant.'

  const invoice: InvoiceContext = {
    vendor_name: 'Google',
    invoice_date: '2026-03-01',
    invoice_number: 'INV-001',
    amount: 16.20,
    tax: 0,
    currency: 'EUR',
    raw_text: 'Google invoice',
    similarity: 0.95,
  }

  it('includes the system prompt', () => {
    const result = buildPrompt(SYSTEM, 'question', [], '', [])
    expect(result).toContain(SYSTEM)
  })

  it('includes the user message', () => {
    const result = buildPrompt(SYSTEM, 'What did I spend?', [], '', [])
    expect(result).toContain('What did I spend?')
  })

  it('formats invoice context into the prompt', () => {
    const result = buildPrompt(SYSTEM, 'q', [invoice], '', [])
    expect(result).toContain('Google')
    expect(result).toContain('INV-001')
    expect(result).toContain('16.2')
  })

  it('shows no-match message when invoices array is empty', () => {
    const result = buildPrompt(SYSTEM, 'q', [], '', [])
    expect(result).toContain('No matching invoices found')
  })

  it('appends aggregate context when provided', () => {
    const result = buildPrompt(SYSTEM, 'q', [], 'EUR: 100.00 (3 invoices)', [])
    expect(result).toContain('EUR: 100.00 (3 invoices)')
  })

  it('omits aggregate section when aggregateContext is empty string', () => {
    const result = buildPrompt(SYSTEM, 'q', [], '', [])
    expect(result).not.toContain('Global approved invoice totals')
  })

  it('inserts history messages in order before the user message', () => {
    const history: ConversationMessage[] = [
      { role: 'user', text: 'First question' },
      { role: 'assistant', text: 'First answer' },
    ]
    const result = buildPrompt(SYSTEM, 'Follow-up', [], '', history)
    const firstIdx = result.indexOf('First question')
    const firstAnswerIdx = result.indexOf('First answer')
    const followUpIdx = result.indexOf('Follow-up')
    expect(firstIdx).toBeGreaterThan(-1)
    expect(firstIdx).toBeLessThan(firstAnswerIdx)
    expect(firstAnswerIdx).toBeLessThan(followUpIdx)
  })

  it('omits history section when history is empty', () => {
    const result = buildPrompt(SYSTEM, 'q', [], '', [])
    expect(result).not.toContain('Conversation so far')
  })

  it('uses fallback values for null invoice fields', () => {
    const nullInvoice: InvoiceContext = {
      vendor_name: null,
      invoice_date: null,
      invoice_number: null,
      amount: null,
      tax: null,
      currency: null,
      raw_text: null,
      similarity: 0.8,
    }
    const result = buildPrompt(SYSTEM, 'q', [nullInvoice], '', [])
    expect(result).not.toContain('null')
    expect(result).toContain('Unknown')
  })
})
