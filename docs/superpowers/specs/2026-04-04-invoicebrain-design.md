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
| AI — Embeddings | Gemini `gemini-embedding-001` (768 dimensions) |
| AI — Chat | Gemini `gemini-2.0-flash` |
| Automation | n8n (external, not built here) |
| n8n → Supabase | HTTP Request (Gemini embedding API) + Supabase node (insert with embedding) |

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
  id                  uuid primary key default gen_random_uuid(),
  status              invoice_status not null default 'pending',
  vendor_name         text,
  invoice_date        date,
  invoice_number      text,
  amount              numeric(12, 2),
  tax                 numeric(12, 2),
  currency            char(3),
  raw_text            text,
  embedding           vector(768),    -- gemini-embedding-001, 768 dims
  metadata            jsonb,          -- full Gemini extraction JSON
  gmail_message_id    text unique,    -- Gmail message ID = PDF filename stem
  source_vendor_email text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz default now(),
  last_updated_by     text default 'system_n8n'
);

-- Deduplication
create unique index invoices_unique_invoice on invoices (invoice_number, vendor_name);

-- HNSW partial index — approved rows only
create index invoices_embedding_idx on invoices
  using hnsw (embedding vector_cosine_ops)
  where status = 'approved';
```

- `embedding` is nullable — populated by n8n **at insert time** (not at approval time)
- Partial index on `status = 'approved'` enforces human-in-the-loop at the database level — pending rows are invisible to vector search without any application filtering
- `metadata` stores the full nested JSON from Gemini extraction (billing ID, line items, customer details, etc.)
- Full schema with triggers and RPC functions: `docs/db/001-initial-schema.sql`

---

## 5. Data Flow

```
n8n (external, no Next.js webhook)
  Gmail trigger (from:payments-noreply@google.com has:attachment)
  → Supabase Storage Upload: PUT invoices/{gmail_message_id}.pdf
  → [Supabase DB trigger on_invoice_upload fires automatically]
  → n8n Webhook receives: { file_path, bucket_id }
  → HTTP Request: fetch PDF binary from Supabase Storage
  → Gemini 2.0 Flash (multimodal): extract structured JSON from PDF
  → Code node: flatten JSON → DB columns, build raw_text for embedding
  → Supabase: check (invoice_number, vendor_name) for duplicates
  → IF new: HTTP Request → gemini-embedding-001 → 768-dim vector
            Supabase INSERT: all fields + embedding (status='pending')
  → IF duplicate: UPDATE updated_at only
  Row is ready for review with embedding already populated.

User (Review UI)
  → GET /review
      Fetches all status='pending' rows from Supabase
  → PATCH /api/approve/[id]
      Updates status → 'approved' only (embedding already exists)
      Returns 200

User (Chat UI)
  → POST /api/chat
      1. Embeds question via Gemini gemini-embedding-001
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
1. Gmail trigger — polls for emails from `payments-noreply@google.com` with PDF attachments
2. Supabase Storage Upload — stores PDF at `invoices/{gmail_message_id}.pdf`
3. Supabase DB trigger (`on_invoice_upload`) — fires on storage insert, calls n8n Webhook
4. n8n Webhook → HTTP Request → fetches PDF binary from storage
5. Gemini 2.0 Flash (multimodal) — reads PDF directly, returns structured JSON
6. Code node — flattens JSON to DB columns, builds `raw_text`
7. Dedup check — skips if `(invoice_number, vendor_name)` already exists
8. HTTP Request → `gemini-embedding-001` — generates 768-dim vector from `raw_text`
9. Supabase node — `INSERT` with all fields + embedding (`status='pending'`)

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
