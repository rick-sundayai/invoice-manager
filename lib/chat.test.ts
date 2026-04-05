// lib/chat.test.ts
import { isAggregativeQuery, parseDataBlock } from './chat'

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
