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
| n8n → Supabase | Supabase DB node (insert invoices) + Supabase Vector Store node (generate + store embeddings) |

No auth for MVP. No Supabase Edge Functions. n8n writes directly to Supabase — no Next.js webhook needed.

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
    chat/
      route.ts                # POST — Gemini hybrid search + response
    approve/
      [id]/
        route.ts              # PATCH — flip status to 'approved' only

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
n8n (external, no Next.js webhook)
  Gmail trigger
  → LLM extraction (vendor, date, invoice #, amount, tax, currency, raw_text)
  → Supabase DB node: INSERT into invoices (status='pending')
  → Supabase Vector Store node: generate embedding from raw_text, write to invoices.embedding
  Row is ready for review with embedding already populated.

User (Review UI)
  → GET /review
      Fetches all status='pending' rows from Supabase
  → PATCH /api/approve/[id]
      Updates status → 'approved' only (embedding already exists)
      Returns 200

User (Chat UI)
  → POST /api/chat
      1. Embeds question via Gemini text-embedding-004
      2. Vector similarity search (approved rows only, HNSW index)
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
- Clicking ✓ calls `PATCH /api/approve/[id]` (status update only), optimistically removes the row
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

## 8. n8n Integration Notes

n8n writes directly to Supabase — no Next.js API route is involved in the ingestion pipeline.

**n8n workflow:**
1. Gmail trigger — polls for unread emails with PDF attachments
2. LLM extraction — sends PDF to model, extracts structured fields
3. Supabase DB node — `INSERT` into `invoices` with `status='pending'`
4. Supabase Vector Store node — generates embedding from `raw_text`, writes to `invoices.embedding`

All fields are optional at insert — the user corrects any extraction errors in the Review UI before approving.

---

## 9. Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
```

---

## 10. Out of Scope (MVP)

- Authentication / multi-user
- Supabase Edge Functions
- Pagination on Review Inbox
- Invoice PDF viewer
- Export / reporting
