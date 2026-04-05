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

-- Vector search RPC function
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
