# Chat Functionality — Finish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the chat interface by adding error handling, conversation history (multi-turn context), markdown rendering for AI responses, and suggested prompt chips in the empty state.

**Architecture:** Extract `buildPrompt()` and supporting types into `lib/chat.ts` so they are unit-testable. The API route accepts an optional `history` array and passes it to `buildPrompt()`. The UI sends the current message thread as history on each request, displays errors inline, and renders AI text as markdown.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, react-markdown (install), Tailwind v4

---

## File Map

| File | Change |
|---|---|
| `lib/chat.ts` | Add `InvoiceContext`, `ConversationMessage` types + `buildPrompt()` |
| `lib/chat.test.ts` | Add tests for `buildPrompt()` |
| `app/api/chat/route.ts` | Accept `history`, remove inline types, use `buildPrompt()` |
| `components/chat-window.tsx` | Error handling, send history, suggested prompts, markdown |

---

## Task 1: Add `buildPrompt()` to `lib/chat.ts`

**Files:**
- Modify: `lib/chat.ts`
- Modify: `lib/chat.test.ts`

### Step 1.1: Write the failing tests

Add these tests to `lib/chat.test.ts` after the existing `describe` blocks:

```ts
import { isAggregativeQuery, parseDataBlock, stripDataBlock, buildPrompt } from './chat'
import type { InvoiceContext, ConversationMessage } from './chat'

// ... existing tests unchanged ...

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
})
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
npx jest lib/chat.test.ts --no-coverage
```

Expected: FAIL — `buildPrompt is not a function` (or similar import error)

- [ ] **Step 1.3: Add types and `buildPrompt()` to `lib/chat.ts`**

Replace the entire file content:

```ts
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

export function buildPrompt(
  systemPrompt: string,
  message: string,
  invoices: InvoiceContext[],
  aggregateContext: string,
  history: ConversationMessage[]
): string {
  const invoiceLines =
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

  const aggregateSection = aggregateContext
    ? `\n\nGlobal approved invoice totals by currency:\n${aggregateContext}`
    : ''

  const historySection =
    history.length > 0
      ? '\n\nConversation so far:\n' +
        history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n')
      : ''

  return `${systemPrompt}

Relevant invoices:
${invoiceLines}${aggregateSection}${historySection}

User: ${message}`
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
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```bash
npx jest lib/chat.test.ts --no-coverage
```

Expected: All tests PASS (including original tests for `isAggregativeQuery`, `parseDataBlock`, `stripDataBlock`)

- [ ] **Step 1.5: Commit**

```bash
git add lib/chat.ts lib/chat.test.ts
git commit -m "feat: add buildPrompt() with InvoiceContext and ConversationMessage types"
```

---

## Task 2: Update `/api/chat` to accept history and use `buildPrompt()`

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 2.1: Replace the route file content**

```ts
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
```

- [ ] **Step 2.2: Run lint to catch any type errors**

```bash
npm run lint
```

Expected: No errors. If TypeScript errors appear, check that `InvoiceContext` and `ConversationMessage` are imported correctly from `@/lib/chat`.

- [ ] **Step 2.3: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: chat API accepts history array for multi-turn context"
```

---

## Task 3: Update `ChatWindow` — error handling, history, suggested prompts, markdown

**Files:**
- Modify: `components/chat-window.tsx`

This task installs `react-markdown` and rewrites the component.

- [ ] **Step 3.1: Install react-markdown**

```bash
npm install react-markdown
```

Expected: Package added to `node_modules`. No errors.

- [ ] **Step 3.2: Replace the component file**

```tsx
// components/chat-window.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChatResults } from '@/components/chat-results'
import type { DataBlock } from '@/lib/chat'
import type { ConversationMessage } from '@/lib/chat'

type Message = {
  role: 'user' | 'assistant' | 'error'
  text: string
}

const SUGGESTED_PROMPTS = [
  'What did I spend last month?',
  'Show me all Google invoices',
  'What was my largest invoice?',
  'Total spend by vendor',
]

export function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([])
  const [data, setData] = useState<DataBlock | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send(overrideMessage?: string) {
    const message = (overrideMessage ?? input).trim()
    if (!message || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: message }])
    setLoading(true)

    const history: ConversationMessage[] = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', text: m.text }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history }),
      })

      const json = await res.json() as { text?: string; data?: DataBlock | null; error?: string }

      if (!res.ok || json.error) {
        setMessages(prev => [
          ...prev,
          { role: 'error', text: json.error ?? 'Something went wrong. Please try again.' },
        ])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', text: json.text ?? '' }])
        setData(json.data ?? null)
      }
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'error', text: 'Network error. Please try again.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') send()
  }

  return (
    <div className="flex h-full">
      {/* Conversation panel */}
      <div className="flex flex-col flex-1 border-r border-slate-200">
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <p className="text-slate-400 text-sm">Ask anything about your invoices.</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-sm">
                {SUGGESTED_PROMPTS.map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => send(prompt)}
                    disabled={loading}
                    className="text-xs px-3 py-1.5 rounded-full border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            if (msg.role === 'user') {
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[80%] rounded-xl px-4 py-2 text-sm bg-blue-600 text-white">
                    {msg.text}
                  </div>
                </div>
              )
            }

            if (msg.role === 'error') {
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[80%] rounded-xl px-4 py-2 text-sm bg-red-50 border border-red-200 text-red-600">
                    {msg.text}
                  </div>
                </div>
              )
            }

            return (
              <div key={i} className="flex justify-start">
                <div className="max-w-[80%] rounded-xl px-4 py-2 text-sm bg-white border border-slate-200 text-slate-900">
                  <div className="[&_p:not(:last-child)]:mb-2 [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4 [&_li]:mb-0.5 [&_strong]:font-semibold">
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  </div>
                </div>
              </div>
            )
          })}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm text-slate-400">
                Thinking…
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t border-slate-200 flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your invoices..."
            disabled={loading}
            className="flex-1"
          />
          <Button onClick={() => send()} disabled={loading || !input.trim()}>
            Send
          </Button>
        </div>
      </div>

      {/* Results panel */}
      <div className="w-64 shrink-0 bg-slate-50 overflow-y-auto">
        <ChatResults data={data} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3.3: Run lint**

```bash
npm run lint
```

Expected: No errors. If `react-markdown` has a type issue, add `// @ts-expect-error` above the import as a last resort (unlikely).

- [ ] **Step 3.4: Smoke test in the browser**

```bash
npm run dev
```

Navigate to `http://localhost:3000/chat`. Verify:
1. Suggested prompt chips appear in empty state
2. Clicking a chip sends the message without typing
3. Error state renders correctly (temporarily break the API URL to test)
4. AI responses with **bold** or lists render with proper formatting
5. Sending a follow-up question includes prior conversation context (Gemini should answer "What else did I spend?" coherently)

- [ ] **Step 3.5: Commit**

```bash
git add components/chat-window.tsx package.json package-lock.json
git commit -m "feat: chat UI — error handling, conversation history, markdown rendering, suggested prompts"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ User messages right-aligned, blue — unchanged
- ✅ AI responses left-aligned, white card — unchanged
- ✅ Data panel — unchanged
- ✅ "No data results" state — unchanged
- ✅ Error handling — Task 3
- ✅ Multi-turn history — Tasks 1–3
- ✅ Markdown rendering — Task 3
- ✅ Suggested prompts — Task 3

**Type consistency:**
- `InvoiceContext` defined in `lib/chat.ts`, imported in `route.ts` (Task 2) — consistent
- `ConversationMessage` defined in `lib/chat.ts`, imported in both `route.ts` and `chat-window.tsx` — consistent
- `buildPrompt()` signature matches usage in `route.ts` — consistent

**No placeholders:** All steps contain complete code.
