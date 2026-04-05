# InvoiceBrain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal invoice management app with a human-in-the-loop review inbox and Gemini-powered financial chat, backed by Supabase + pgvector.

**Architecture:** Next.js 16 App Router with a dark left sidebar shell. n8n writes invoices directly to Supabase (no webhook). The Next.js app handles approval (status flip only) and chat (Gemini hybrid vector + SQL search). All AI uses Gemini — `text-embedding-004` for embeddings, `gemini-2.0-flash` for chat.

**Tech Stack:** Next.js 16, Tailwind CSS v4, Shadcn/UI, @supabase/supabase-js, @google/generative-ai, Jest (unit tests for pure utilities only)

---

## File Map

| File | Purpose |
|---|---|
| `types/invoice.ts` | Shared TypeScript types |
| `lib/supabase.ts` | Server-side Supabase client factory |
| `lib/gemini.ts` | Gemini AI client + embedText + generateResponse helpers |
| `lib/chat.ts` | Pure utility functions: isAggregativeQuery, parseDataBlock |
| `app/layout.tsx` | Root layout with sidebar shell |
| `app/page.tsx` | Redirect → /review |
| `components/sidebar.tsx` | Dark left nav (Review + Chat links, pending badge) |
| `app/review/page.tsx` | Server component — fetches pending invoices |
| `components/invoice-table.tsx` | Client component — Shadcn table with approve buttons |
| `app/review/[id]/page.tsx` | Server component + inline server action — edit + approve |
| `app/api/approve/[id]/route.ts` | PATCH — flip status to 'approved' |
| `app/chat/page.tsx` | Chat shell — renders chat-window + chat-results |
| `components/chat-window.tsx` | Client component — conversation thread + input |
| `components/chat-results.tsx` | Client component — structured data panel |
| `app/api/chat/route.ts` | POST — embed → vector search → optional SQL aggregate → Gemini |

---

## Task 1: Install Dependencies & Configure Environment

**Files:**
- Create: `.env.local`
- Modify: `package.json` (via npm)

- [ ] **Step 1: Install Supabase and Gemini packages**

```bash
npm install @supabase/supabase-js @google/generative-ai
```

Expected: both packages appear in `package.json` dependencies.

- [ ] **Step 2: Initialize Shadcn/UI**

```bash
npx shadcn@latest init
```

When prompted:
- Style: **Default**
- Base color: **Slate**
- CSS variables: **Yes**

This updates `app/globals.css` with Shadcn CSS variables and creates `components/ui/`. It detects Tailwind v4 automatically.

- [ ] **Step 3: Add Shadcn components**

```bash
npx shadcn@latest add button table input form badge label
```

Expected: `components/ui/button.tsx`, `components/ui/table.tsx`, `components/ui/input.tsx`, `components/ui/form.tsx`, `components/ui/badge.tsx`, `components/ui/label.tsx` created.

- [ ] **Step 4: Create `.env.local`**

```bash
touch .env.local
```

Add the following (fill in real values from Supabase dashboard and Google AI Studio):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-api-key
```

> `.env.local` is already in `.gitignore` — do not commit it.

- [ ] **Step 5: Verify dev server starts**

```bash
npm run dev
```

Expected: dev server starts at http://localhost:3000 with no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json components/ui/ app/globals.css components.json
git commit -m "feat: install dependencies and initialise Shadcn/UI"
```

---

## Task 2: Shared Types + Library Clients

**Files:**
- Create: `types/invoice.ts`
- Create: `lib/supabase.ts`
- Create: `lib/gemini.ts`

- [ ] **Step 1: Create `types/invoice.ts`**

```typescript
// types/invoice.ts
export type InvoiceStatus = 'pending' | 'approved'

export type Invoice = {
  id: string
  status: InvoiceStatus
  vendor_name: string | null
  invoice_date: string | null
  invoice_number: string | null
  amount: number | null
  tax: number | null
  currency: string | null
  raw_text: string | null
  embedding: number[] | null
  created_at: string
}

export type InvoiceRow = Omit<Invoice, 'embedding'>
```

- [ ] **Step 2: Create `lib/supabase.ts`**

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
```

- [ ] **Step 3: Create `lib/gemini.ts`**

```typescript
// lib/gemini.ts
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export async function embedText(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: 'text-embedding-004' })
  const result = await model.embedContent(text)
  return result.embedding.values
}

export async function generateResponse(prompt: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
  const result = await model.generateContent(prompt)
  return result.response.text()
}
```

- [ ] **Step 4: Commit**

```bash
git add types/invoice.ts lib/supabase.ts lib/gemini.ts
git commit -m "feat: add shared types and library clients"
```

---

## Task 3: Database Schema

**Files:** (SQL run in Supabase SQL Editor — no project files changed)

- [ ] **Step 1: Run schema migration in Supabase SQL Editor**

Open your Supabase project → SQL Editor → New Query. Paste and run:

```sql
-- Enable pgvector
create extension if not exists vector;

-- Status enum
create type invoice_status as enum ('pending', 'approved');

-- Invoices table
create table invoices (
  id              uuid primary key default gen_random_uuid(),
  status          invoice_status not null default 'pending',
  vendor_name     text,
  invoice_date    date,
  invoice_number  text,
  amount          numeric(12, 2),
  tax             numeric(12, 2),
  currency        char(3),
  raw_text        text,
  embedding       vector(768),
  created_at      timestamptz not null default now()
);

-- HNSW partial index — only approved rows, performs well at small scale
create index on invoices using hnsw (embedding vector_cosine_ops)
  where status = 'approved';
```

Expected: table appears in Supabase Table Editor.

- [ ] **Step 2: Create the vector search RPC function**

In a new SQL Editor query:

```sql
create or replace function search_invoices(
  query_embedding vector(768),
  match_count int default 5
)
returns table (
  id uuid,
  vendor_name text,
  invoice_date date,
  invoice_number text,
  amount numeric,
  tax numeric,
  currency text,
  raw_text text,
  similarity float
)
language sql stable
as $$
  select
    id,
    vendor_name,
    invoice_date,
    invoice_number,
    amount,
    tax,
    currency,
    raw_text,
    1 - (embedding <=> query_embedding) as similarity
  from invoices
  where status = 'approved'
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

Expected: function appears in Supabase → Database → Functions.

- [ ] **Step 3: Insert a test row to verify the table works**

```sql
insert into invoices (vendor_name, invoice_number, amount, currency, status)
values ('Test Vendor', 'TEST-001', 99.99, 'EUR', 'pending');

select id, vendor_name, status from invoices;
```

Expected: one row returned with `status = 'pending'`.

- [ ] **Step 4: Clean up test row**

```sql
delete from invoices where invoice_number = 'TEST-001';
```

- [ ] **Step 5: Save migration SQL to project**

Create `docs/db/001-initial-schema.sql` with the full SQL from steps 1 and 2 for reference:

```bash
mkdir -p docs/db
```

Then create `docs/db/001-initial-schema.sql` with the complete SQL from steps 1 and 2.

- [ ] **Step 6: Commit**

```bash
git add docs/db/001-initial-schema.sql
git commit -m "feat: add database schema migration SQL"
```

---

## Task 4: Root Layout + Sidebar + Home Redirect

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Create: `components/sidebar.tsx`

- [ ] **Step 1: Create `components/sidebar.tsx`**

```typescript
// components/sidebar.tsx
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'

type SidebarProps = {
  pendingCount: number
}

export function Sidebar({ pendingCount }: SidebarProps) {
  return (
    <aside className="w-56 shrink-0 bg-slate-900 flex flex-col h-full">
      <div className="px-4 py-5">
        <span className="text-white font-bold text-base tracking-tight">
          InvoiceBrain
        </span>
      </div>

      <nav className="flex flex-col gap-1 px-2">
        <Link
          href="/review"
          className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <span className="flex items-center gap-2">
            <span>📋</span>
            Review
          </span>
          {pendingCount > 0 && (
            <Badge className="bg-blue-600 hover:bg-blue-600 text-white text-xs px-2">
              {pendingCount}
            </Badge>
          )}
        </Link>

        <Link
          href="/chat"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
        >
          <span>💬</span>
          Chat
        </Link>
      </nav>
    </aside>
  )
}
```

- [ ] **Step 2: Update `app/layout.tsx`**

```typescript
// app/layout.tsx
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { Sidebar } from '@/components/sidebar'
import { createServerClient } from '@/lib/supabase'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'InvoiceBrain',
  description: 'Personal invoice manager',
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = createServerClient()
  const { count } = await supabase
    .from('invoices')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex h-full bg-slate-50">
        <Sidebar pendingCount={count ?? 0} />
        <main className="flex-1 overflow-auto">{children}</main>
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Update `app/page.tsx`**

```typescript
// app/page.tsx
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/review')
}
```

- [ ] **Step 4: Verify in browser**

Run `npm run dev`. Visit http://localhost:3000 — should redirect to http://localhost:3000/review (404 is fine, page doesn't exist yet). Sidebar should appear on the left with dark slate background.

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx app/page.tsx components/sidebar.tsx
git commit -m "feat: add root layout with sidebar and home redirect"
```

---

## Task 5: Approve API Route

**Files:**
- Create: `app/api/approve/[id]/route.ts`

- [ ] **Step 1: Create `app/api/approve/[id]/route.ts`**

```typescript
// app/api/approve/[id]/route.ts
import { createServerClient } from '@/lib/supabase'

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServerClient()

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'approved' })
    .eq('id', id)
    .eq('status', 'pending')

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true }, { status: 200 })
}
```

- [ ] **Step 2: Insert a test pending invoice via Supabase SQL Editor**

```sql
insert into invoices (id, vendor_name, invoice_number, amount, currency, status)
values ('11111111-1111-1111-1111-111111111111', 'Test Vendor', 'TEST-002', 150.00, 'USD', 'pending');
```

- [ ] **Step 3: Test the approve route with curl**

```bash
curl -X PATCH http://localhost:3000/api/approve/11111111-1111-1111-1111-111111111111
```

Expected response:
```json
{"success":true}
```

- [ ] **Step 4: Verify status changed in Supabase**

```sql
select id, vendor_name, status from invoices where id = '11111111-1111-1111-1111-111111111111';
```

Expected: `status = 'approved'`.

- [ ] **Step 5: Clean up test row**

```sql
delete from invoices where id = '11111111-1111-1111-1111-111111111111';
```

- [ ] **Step 6: Commit**

```bash
git add app/api/approve/
git commit -m "feat: add approve API route"
```

---

## Task 6: Review Inbox Page + Invoice Table Component

**Files:**
- Create: `app/review/page.tsx`
- Create: `components/invoice-table.tsx`

- [ ] **Step 1: Create `components/invoice-table.tsx`**

```typescript
// components/invoice-table.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import type { InvoiceRow } from '@/types/invoice'

type InvoiceTableProps = {
  invoices: InvoiceRow[]
}

export function InvoiceTable({ invoices: initial }: InvoiceTableProps) {
  const router = useRouter()
  const [invoices, setInvoices] = useState(initial)
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set())

  async function approve(id: string) {
    setApprovingIds(prev => new Set(prev).add(id))
    const res = await fetch(`/api/approve/${id}`, { method: 'PATCH' })
    if (res.ok) {
      setInvoices(prev => prev.filter(inv => inv.id !== id))
      router.refresh()
    }
    setApprovingIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  async function approveAll() {
    for (const inv of invoices) {
      await approve(inv.id)
    }
  }

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p className="text-lg font-medium">All caught up</p>
        <p className="text-sm mt-1">No invoices pending review.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">{invoices.length} invoices awaiting approval</p>
        <Button
          size="sm"
          variant="outline"
          onClick={approveAll}
          disabled={approvingIds.size > 0}
        >
          Approve All
        </Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="font-semibold text-slate-600">Vendor</TableHead>
              <TableHead className="font-semibold text-slate-600">Date</TableHead>
              <TableHead className="font-semibold text-slate-600">Amount</TableHead>
              <TableHead className="font-semibold text-slate-600">Tax</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map(inv => (
              <TableRow key={inv.id}>
                <TableCell>
                  <p className="font-semibold text-slate-900">{inv.vendor_name ?? '—'}</p>
                  {inv.invoice_number && (
                    <Link
                      href={`/review/${inv.id}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {inv.invoice_number}
                    </Link>
                  )}
                </TableCell>
                <TableCell className="text-sm text-slate-500">
                  {inv.invoice_date
                    ? new Date(inv.invoice_date).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                    : '—'}
                </TableCell>
                <TableCell>
                  <p className="font-bold text-slate-900">
                    {inv.amount != null ? inv.amount.toFixed(2) : '—'}
                  </p>
                  <p className="text-xs text-slate-400">{inv.currency ?? ''}</p>
                </TableCell>
                <TableCell className="text-sm text-slate-500">
                  {inv.tax != null ? inv.tax.toFixed(2) : '—'}
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => approve(inv.id)}
                    disabled={approvingIds.has(inv.id)}
                  >
                    ✓
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `app/review/page.tsx`**

```typescript
// app/review/page.tsx
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
```

- [ ] **Step 3: Seed test data in Supabase SQL Editor**

```sql
insert into invoices (vendor_name, invoice_number, invoice_date, amount, tax, currency, raw_text, status)
values
  ('AWS Services Ltd.', 'INV-2025-001', '2025-01-02', 2400.00, 384.00, 'EUR', 'AWS invoice January 2025', 'pending'),
  ('Figma Inc.', 'FIG-10284', '2025-01-05', 45.00, 0.00, 'USD', 'Figma subscription January 2025', 'pending'),
  ('Adobe Systems', 'AD-44192', '2025-01-07', 54.99, 0.00, 'USD', 'Adobe Creative Cloud January 2025', 'pending');
```

- [ ] **Step 4: Verify in browser**

Visit http://localhost:3000/review — should show a table with 3 invoices. The sidebar pending badge should show **3**. Clicking ✓ on a row should remove it from the table.

- [ ] **Step 5: Clean up seed data**

```sql
delete from invoices where invoice_number in ('INV-2025-001', 'FIG-10284', 'AD-44192');
```

- [ ] **Step 6: Commit**

```bash
git add app/review/page.tsx components/invoice-table.tsx
git commit -m "feat: add review inbox page and invoice table component"
```

---

## Task 7: Edit Invoice Page

**Files:**
- Create: `app/review/[id]/page.tsx`

- [ ] **Step 1: Create `app/review/[id]/page.tsx`**

```typescript
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
        currency: (formData.get('currency') as string).toUpperCase() || null,
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
```

- [ ] **Step 2: Seed a test row**

```sql
insert into invoices (id, vendor_name, invoice_number, amount, currency, status)
values ('22222222-2222-2222-2222-222222222222', 'Edit Test Vendor', 'EDIT-001', 999.00, 'GBP', 'pending');
```

- [ ] **Step 3: Verify in browser**

Visit http://localhost:3000/review/22222222-2222-2222-2222-222222222222 — should show a pre-filled form. Edit a field and click "Save & Approve" — should redirect to `/review` and the row should be gone.

- [ ] **Step 4: Clean up**

```sql
delete from invoices where invoice_number = 'EDIT-001';
```

- [ ] **Step 5: Commit**

```bash
git add app/review/
git commit -m "feat: add edit invoice page with server action approve"
```

---

## Task 8: Chat Utility Functions + Unit Tests

**Files:**
- Create: `lib/chat.ts`
- Create: `lib/chat.test.ts`

- [ ] **Step 1: Install Jest and ts-jest**

```bash
npm install --save-dev jest ts-jest @types/jest
```

- [ ] **Step 2: Create `jest.config.ts`**

```typescript
// jest.config.ts
import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['**/*.test.ts'],
}

export default config
```

- [ ] **Step 3: Add test script to `package.json`**

In `package.json`, add to `"scripts"`:

```json
"test": "jest"
```

- [ ] **Step 4: Write the failing tests first**

Create `lib/chat.test.ts`:

```typescript
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
```

- [ ] **Step 5: Run tests to confirm they fail**

```bash
npm test
```

Expected: FAIL — `lib/chat` module not found.

- [ ] **Step 6: Create `lib/chat.ts` to make tests pass**

```typescript
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
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
npm test
```

Expected:
```
PASS  lib/chat.test.ts
  isAggregativeQuery
    ✓ returns true for "total" keyword
    ✓ returns true for "sum" keyword
    ✓ returns true for "how much" phrase
    ✓ returns true for "spend" keyword
    ✓ returns false for a semantic question
    ✓ is case-insensitive
  parseDataBlock
    ✓ returns null when no data block present
    ✓ parses a valid data block
    ✓ returns null when data block contains invalid JSON

Test Suites: 1 passed
Tests:       9 passed
```

- [ ] **Step 8: Commit**

```bash
git add lib/chat.ts lib/chat.test.ts jest.config.ts package.json package-lock.json
git commit -m "feat: add chat utility functions with unit tests"
```

---

## Task 9: Chat API Route

**Files:**
- Create: `app/api/chat/route.ts`

- [ ] **Step 1: Create `app/api/chat/route.ts`**

```typescript
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
```

- [ ] **Step 2: Seed an approved invoice with a mock embedding for testing**

```sql
-- Insert an approved invoice (embedding can be all zeros for manual testing)
insert into invoices (
  id, vendor_name, invoice_number, invoice_date, amount, tax, currency, raw_text, status, embedding
)
values (
  '33333333-3333-3333-3333-333333333333',
  'Chat Test Vendor',
  'CHAT-001',
  '2025-01-10',
  500.00,
  80.00,
  'EUR',
  'Chat Test Vendor invoice for software services January 2025',
  'approved',
  array_fill(0::float4, ARRAY[768])::vector(768)
);
```

- [ ] **Step 3: Test the chat route with curl**

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What invoices do I have?"}'
```

Expected: JSON response with `text` (prose) and `data` (null or structured data).

- [ ] **Step 4: Test with an aggregative query**

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is my total spend?"}'
```

Expected: `data` field should be non-null with total and currency breakdown.

- [ ] **Step 5: Clean up test row**

```sql
delete from invoices where id = '33333333-3333-3333-3333-333333333333';
```

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/
git commit -m "feat: add chat API route with Gemini hybrid search"
```

---

## Task 10: Chat UI

**Files:**
- Create: `components/chat-results.tsx`
- Create: `components/chat-window.tsx`
- Create: `app/chat/page.tsx`

- [ ] **Step 1: Create `components/chat-results.tsx`**

```typescript
// components/chat-results.tsx
import type { DataBlock } from '@/lib/chat'

type ChatResultsProps = {
  data: DataBlock | null
}

export function ChatResults({ data }: ChatResultsProps) {
  if (!data || data.items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-slate-400">No data results</p>
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-col gap-3">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Results</p>

      {data.items.map((item, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-400">{item.vendor}</p>
          <p className="text-lg font-bold text-blue-700 mt-1">
            {item.amount.toFixed(2)}{' '}
            <span className="text-sm font-normal text-slate-500">{item.currency}</span>
          </p>
        </div>
      ))}

      {data.total != null && (
        <div className="bg-slate-900 rounded-lg p-4">
          <p className="text-xs text-slate-400">Total</p>
          <p className="text-lg font-bold text-white mt-1">
            {data.total.toFixed(2)}{' '}
            <span className="text-sm font-normal text-slate-400">{data.currency ?? ''}</span>
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `components/chat-window.tsx`**

```typescript
// components/chat-window.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChatResults } from '@/components/chat-results'
import type { DataBlock } from '@/lib/chat'

type Message = {
  role: 'user' | 'assistant'
  text: string
}

export function ChatWindow() {
  const [messages, setMessages] = useState<Message[]>([])
  const [data, setData] = useState<DataBlock | null>(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function send() {
    const message = input.trim()
    if (!message || loading) return

    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: message }])
    setLoading(true)

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })

    const json = await res.json() as { text: string; data: DataBlock | null }
    setMessages(prev => [...prev, { role: 'assistant', text: json.text }])
    setData(json.data)
    setLoading(false)
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
            <div className="flex items-center justify-center h-full">
              <p className="text-slate-400 text-sm">Ask anything about your invoices.</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-slate-200 text-slate-900'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}

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
          <Button onClick={send} disabled={loading || !input.trim()}>
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

- [ ] **Step 3: Create `app/chat/page.tsx`**

```typescript
// app/chat/page.tsx
import { ChatWindow } from '@/components/chat-window'

export default function ChatPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-8 py-5 border-b border-slate-200 bg-white">
        <h1 className="text-2xl font-bold text-slate-900">Chat</h1>
        <p className="text-sm text-slate-500 mt-0.5">Ask questions about your approved invoices.</p>
      </div>
      <div className="flex-1 min-h-0">
        <ChatWindow />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify in browser**

Visit http://localhost:3000/chat. Type a question and press Enter or click Send. The response should appear in the conversation thread. If the question is aggregative, data cards should appear in the right panel.

- [ ] **Step 5: Commit**

```bash
git add app/chat/ components/chat-window.tsx components/chat-results.tsx
git commit -m "feat: add chat UI with conversation thread and data results panel"
```

---

## Self-Review Checklist

- [x] **Spec § Data Flow — n8n writes directly to Supabase:** Covered. No Next.js ingestion route. Schema task documents this.
- [x] **Spec § Review Inbox — Approve All:** `approveAll()` in `invoice-table.tsx` loops through all rows.
- [x] **Spec § Review Inbox — invoice number as link:** `InvoiceTable` renders invoice_number as `<Link href={/review/${id}}>`.
- [x] **Spec § Chat — vector search approved only:** `search_invoices` RPC has `where status = 'approved'` filter.
- [x] **Spec § Chat — SQL aggregate for aggregative queries:** `isAggregativeQuery` gates the currency aggregate query.
- [x] **Spec § Chat — structured data panel:** `ChatResults` renders data cards; shows "No data results" when null.
- [x] **Spec § Edit page — redirect after approve:** Server action calls `redirect('/review')`.
- [x] **Spec § Sidebar — pending count badge:** Layout fetches count and passes to `<Sidebar pendingCount={count} />`.
- [x] **Type consistency:** `InvoiceRow` used in `InvoiceTable` props and review page. `DataBlock` shared between `lib/chat.ts`, `chat-results.tsx`, and `chat-window.tsx`.
- [x] **No placeholders:** All code blocks are complete and concrete.
