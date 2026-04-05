# InvoiceBrain — Design Spec
**Date:** 2026-04-04  
**Status:** Approved

---

## 1. Overview

A personal invoice management tool that automates extraction of financial data from Gmail PDFs via n8n, provides a human-in-the-loop review UI, and a financial chat interface powered by Gemini. Built to be reusable as a codebase template for future projects.

---

## 2. Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router), Tailwind CSS v4, Shadcn/UI |
| Backend | Supabase (PostgreSQL + pgvector) |
| AI — Embeddings | Gemini `text-embedding-004` (768 dimensions) |
| AI — Chat | Gemini `gemini-2.0-flash` |
| Automation | n8n (external, not built here) |

No auth for MVP. No Supabase Edge Functions — embedding generation happens in the Next.js approval route handler.

---

## 3. Project Structure

```
app/
  layout.tsx                  # Root layout with sidebar shell
  page.tsx                    # Redirect → /review
  review/
    page.tsx                  # Review Inbox (pending invoices table)
    [id]/
      page.tsx                # Edit single invoice before approving
  chat/
    page.tsx                  # Chat UI (conversation + data panel)
  api/
    invoices/
      route.ts                # POST — n8n webhook, inserts pending invoice
    chat/
      route.ts                # POST — Gemini hybrid search + response
    approve/
      [id]/
        route.ts              # PATCH — approve invoice, generate embedding

lib/
  supabase.ts                 # Supabase client (server + browser)
  gemini.ts                   # Gemini client singleton

components/
  sidebar.tsx                 # Left nav (Review + Chat links, pending badge)
  invoice-table.tsx           # Shadcn table, reusable
  chat-window.tsx             # Conversation thread
  chat-results.tsx            # Structured data panel
```

**Reusability principle:** `lib/` and `components/` contain no invoice-specific logic. All feature logic lives in `app/review/` and `app/chat/`. Porting a feature to another project is a folder move.

---

## 4. Database Schema

```sql
create extension if not exists vector;

create type invoice_status as enum ('pending', 'approved');

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

-- HNSW index on approved rows only — performs well at small dataset sizes
create index on invoices using hnsw (embedding vector_cosine_ops)
  where status = 'approved';
```

- `embedding` is nullable — populated at approval time, not on insert
- Partial index on `status = 'approved'` enforces human-in-the-loop at the database level — pending rows are invisible to vector search without any application filtering

---

## 5. Data Flow

```
n8n (external)
  → POST /api/invoices
      Validates Bearer token (N8N_WEBHOOK_SECRET)
      Inserts row: status='pending', embedding=null
      Returns 201 + { id }

User (Review UI)
  → GET /review
      Fetches all status='pending' rows from Supabase
  → PATCH /api/approve/[id]
      1. Updates status → 'approved'
      2. Generates embedding via Gemini text-embedding-004 on raw_text
      3. Writes embedding back to row
      Returns 200

User (Chat UI)
  → POST /api/chat
      1. Embeds question via Gemini text-embedding-004
      2. Vector similarity search (approved rows only, HNSW)
      3. If aggregative question: also runs SQL aggregate (SUM/COUNT)
      4. Passes context + question to gemini-2.0-flash
      5. Streams text response; returns structured data separately
```

---

## 6. Review Inbox UI

**Navigation:** Dark left sidebar (`bg-slate-900`) with app name, Review (with pending-count badge) and Chat nav items.

**Review page (`/review`):** Server component.
- Page heading + "Approve All" button (top-right)
- Shadcn `Table` on a white card, light slate header row
- Columns: Vendor (bold) / Invoice # (muted, links to `/review/[id]`) · Date · Amount + Currency (stacked) · Tax · ✓ approve button
- Route param for `/review/[id]` uses the row UUID; link text displays the invoice number
- Clicking ✓ calls `PATCH /api/approve/[id]`, optimistically removes the row
- "Approve All" calls `PATCH /api/approve/[id]` for every pending row in sequence, clearing the table on completion
- Edit page (`/review/[id]`): Shadcn form to correct any field; submit approves and redirects to `/review`
- Empty state: "All caught up" message

---

## 7. Chat Interface

**Layout:** Two-panel inside main content area.

- **Left panel — conversation thread**
  - User messages: right-aligned, blue background
  - AI responses: left-aligned, white card
  - Input bar pinned to bottom
- **Right panel — structured results**
  - When response includes numeric data: data cards (vendor + amount)
  - Conversational-only answers: subtle "No data results" state

**`/api/chat` logic:**
1. Embed question via `text-embedding-004`
2. Vector similarity search against approved invoices
3. If question contains aggregative keywords ("total", "sum", "how much", "spend"): also run SQL aggregate
4. Pass retrieved invoices + aggregate result as context to `gemini-2.0-flash`
5. System prompt instructs: respond concisely; return any structured breakdown as JSON alongside prose
6. Stream prose to conversation thread; parse JSON for right panel

---

## 8. n8n Webhook

**`POST /api/invoices`**

- Auth: `Authorization: Bearer <secret>` validated against `N8N_WEBHOOK_SECRET` env var. Returns `401` on mismatch.
- Payload: `{ vendor_name, invoice_date, invoice_number, amount, tax, currency, raw_text }`
- All fields optional at insert (n8n extraction may be partial) — user corrects in Review UI before approving
- Returns `201 { id }` on success

---

## 9. Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
N8N_WEBHOOK_SECRET
```

---

## 10. Out of Scope (MVP)

- Authentication / multi-user
- Supabase Edge Functions
- Pagination on Review Inbox
- Invoice PDF viewer
- Export / reporting
