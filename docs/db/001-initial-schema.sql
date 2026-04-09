-- ============================================================
-- InvoiceBrain — Complete Database Schema
-- Project: jqjqupygxbpwsuajudsm.supabase.co
-- ============================================================

-- Enable pgvector
create extension if not exists vector;

-- Enable pg_net (required for storage trigger → n8n webhook)
-- Already enabled in Supabase by default for cloud projects

-- Status enum
create type invoice_status as enum ('pending', 'approved');

-- Invoices table
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
  embedding           vector(768),          -- gemini-embedding-001 = 768 dims
  metadata            jsonb,                -- full nested JSON from Gemini extraction
  gmail_message_id    text unique,          -- Gmail message ID (used as PDF filename)
  source_vendor_email text,                 -- sender email address
  created_at          timestamptz not null default now(),
  updated_at          timestamptz default now(),
  last_updated_by     text default 'system_n8n'
);

-- Deduplication constraint: same invoice from same vendor only once
create unique index invoices_unique_invoice on invoices (invoice_number, vendor_name);

-- Fast lookup by Gmail message ID
create index idx_invoices_gmail_id on invoices (gmail_message_id);

-- Partial HNSW index — only approved rows are searchable via vector similarity
create index invoices_embedding_idx on invoices
  using hnsw (embedding vector_cosine_ops)
  where status = 'approved';

-- Auto-update updated_at on row modification
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger update_invoices_modtime
  before update on invoices
  for each row execute function update_updated_at_column();

-- ============================================================
-- Vector Search RPC
-- Called by Next.js app/api/chat/route.ts
-- Only searches approved rows (HNSW index enforces this)
-- ============================================================
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

-- ============================================================
-- Storage Trigger → n8n Webhook
-- Fires after a PDF is uploaded to the 'invoices' storage bucket.
-- Calls the n8n Webhook node which fetches the PDF, runs Gemini
-- extraction, generates an embedding, and inserts the invoice row.
-- ============================================================
create or replace function handle_new_invoice_upload()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'net', 'extensions'
as $$
begin
  if (lower(new.bucket_id) = 'invoices') then
    perform net.http_post(
      'https://sundayaiwork.app.n8n.cloud/webhook/0f9b3ffa-5f9f-4e54-82bc-a076a941b1a7',
      json_build_object(
        'file_path', new.name,
        'bucket_id', new.bucket_id
      )::jsonb,
      '{}'::jsonb,
      '{"Content-Type": "application/json"}'::jsonb
    );
  end if;
  return new;
end;
$$;

create trigger on_invoice_upload
  after insert on storage.objects
  for each row execute function handle_new_invoice_upload();

-- ============================================================
-- Storage Bucket
-- Private bucket, PDF only, no size limit set
-- ============================================================
-- Run in Supabase dashboard Storage UI or via:
-- insert into storage.buckets (id, name, public, allowed_mime_types)
-- values ('invoices', 'invoices', false, array['application/pdf']);
