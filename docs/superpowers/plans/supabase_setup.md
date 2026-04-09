# Supabase Setup Guide — InvoiceBrain

This guide covers the complete Supabase setup: schema, storage bucket, triggers, vector search function, and credentials.

**Project URL:** `https://jqjqupygxbpwsuajudsm.supabase.co`

## Prerequisites

1. Supabase project with `pgvector` and `pg_net` extensions enabled (on by default for cloud projects)
2. n8n instance (cloud or self-hosted) with the webhook URL known before creating the DB trigger

---

## 1. Database Schema

Full schema is in `docs/db/001-initial-schema.sql`. Run it in the Supabase SQL Editor.

### invoices table (actual live schema)

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
  metadata            jsonb,          -- full Gemini extraction JSON + storage_path
  gmail_message_id    text unique,    -- Gmail message ID = PDF filename stem
  source_vendor_email text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz default now(),
  last_updated_by     text default 'system_n8n'
);

-- Deduplication: same invoice_number + vendor_name is blocked
create unique index invoices_unique_invoice on invoices (invoice_number, vendor_name);

-- Fast lookup when processing Gmail messages
create index idx_invoices_gmail_id on invoices (gmail_message_id);

-- Partial HNSW: vector search only over approved rows
create index invoices_embedding_idx on invoices
  using hnsw (embedding vector_cosine_ops)
  where status = 'approved';
```

### Column notes

| Column | Purpose |
|---|---|
| `embedding` | Populated by n8n at insert time via `gemini-embedding-001` HTTP call |
| `metadata` | Stores the full flattened JSON from the n8n Code node (includes `storage_path`, all Gemini fields) |
| `gmail_message_id` | Set to the Gmail message ID; also used as the PDF filename in storage |
| `status` | Always `pending` on insert; only the Next.js app flips it to `approved` |
| `updated_at` | Auto-updated by DB trigger `update_invoices_modtime` on any row UPDATE |
| `last_updated_by` | Set to `system_n8n` by default; app can set to `user` on approve |

---

## 2. Vector Search Function

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
    id, vendor_name, invoice_date, invoice_number,
    amount, tax, currency, raw_text,
    1 - (embedding <=> query_embedding) as similarity
  from invoices
  where status = 'approved'
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
```

The HNSW partial index ensures this function only touches approved rows.

---

## 3. Storage Bucket

| Field | Value |
|---|---|
| Bucket name | `invoices` |
| Public | ❌ No (private) |
| Allowed MIME types | `application/pdf` |
| Size limit | None |

PDFs are stored at path `{gmail_message_id}.pdf` (e.g. `19d4930da9cc2485.pdf`).

---

## 4. Storage Trigger → n8n Webhook

When a PDF is uploaded to the `invoices` bucket, a PostgreSQL trigger automatically fires the n8n processing pipeline. This is what connects the Gmail upload path to the invoice extraction pipeline.

```sql
-- Fires after any INSERT into storage.objects
create trigger on_invoice_upload
  after insert on storage.objects
  for each row execute function handle_new_invoice_upload();

-- POSTs { file_path, bucket_id } to the n8n Webhook node
create or replace function handle_new_invoice_upload()
returns trigger language plpgsql security definer
set search_path = 'public', 'net', 'extensions'
as $$
begin
  if (lower(new.bucket_id) = 'invoices') then
    perform net.http_post(
      'https://sundayaiwork.app.n8n.cloud/webhook/0f9b3ffa-5f9f-4e54-82bc-a076a941b1a7',
      json_build_object('file_path', new.name, 'bucket_id', new.bucket_id)::jsonb,
      '{}'::jsonb,
      '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
  return new;
end;
$$;
```

> **Note:** `pg_net` must be enabled for `net.http_post` to work. Enable it in Supabase → Extensions.

---

## 5. Credentials

| Key | Where to find | Used by |
|---|---|---|
| Project URL | Settings → API → Project URL | Next.js app + n8n |
| `anon` public key | Settings → API → Project API Keys | Next.js client (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| Service Role secret | Settings → API → Project API Keys | Next.js server (`SUPABASE_SERVICE_ROLE_KEY`) + n8n |

> Always use the **Service Role key** in n8n and Next.js server-side code. It bypasses RLS. Never expose it to the browser.

---

## 6. n8n Integration

n8n writes directly to Supabase. The Next.js app has no webhook. See `docs/superpowers/plans/n8n_vector_store_setup.md` for the full workflow diagram and node config.

**Pipeline summary:**
```
Gmail Trigger → Storage Upload → [DB trigger fires]
Webhook ← DB trigger
  → HTTP Request (fetch PDF)
  → Gemini 2.0 Flash (extract JSON)
  → Code node (format for DB)
  → Supabase (dedup check)
  → IF new: HTTP Request (gemini-embedding-001) → Supabase Insert
  → IF exists: Supabase Update (timestamps only)
```

**Why not the Supabase Vector Store node:** Our `invoices` table has structured columns, not the `content/metadata/embedding` shape that node expects. We use a direct HTTP Request to the Gemini Embedding API and a standard Supabase node for insert.

---

## 7. Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=https://jqjqupygxbpwsuajudsm.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-api-key
```
