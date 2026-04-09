# n8n Workflow — InvoiceBrain

## Architecture Overview

The ingestion pipeline has two entry points that connect via a Supabase storage trigger:

```
[Gmail Trigger] ──────────────────────────────────────────────────────────────
    │  Detects emails from payments-noreply@google.com with PDF attachments
    ▼
[Supabase Storage Upload]
    │  Uploads PDF to storage bucket: invoices/{gmail_message_id}.pdf
    │  (x-upsert: true — safe to re-run)
    │
    │  ◄── Supabase DB trigger fires automatically on storage.objects INSERT
    │      (on_invoice_upload → handle_new_invoice_upload → calls n8n webhook)
    ▼
[Webhook]  ◄─────────── triggered by Supabase storage trigger (not Gmail directly)
    │  Receives: { file_path: "19d4930da9cc2485.pdf", bucket_id: "invoices" }
    ▼
[HTTP Request]
    │  Fetches PDF binary from: supabase.co/storage/v1/object/authenticated/invoices/{file_path}
    │  Response format: file (binary)
    ▼
[Extract Invoice JSON]  (Google Gemini 2.0 Flash — multimodal)
    │  Reads PDF binary directly, returns structured JSON
    │  Schema: see docs/superpowers/plans/invoice_schema.json
    ▼
[Format Data for DB]  (Code node)
    │  Parses Gemini JSON response → flat DB columns
    │  Builds raw_text for embedding
    ▼
[Find Existing Invoice]  (Supabase — Get Many)
    │  Checks: invoice_number = X AND vendor_name = Y
    │  alwaysOutputData: true
    ▼
[IF: Is Invoice New?]
    │  Condition: $json.isEmpty() === true
    │
    ├── TRUE ──► [Generate Text Embeddings] (HTTP Request → Gemini Embedding API)
    │                │  POST gemini-embedding-001:embedContent
    │                │  taskType: RETRIEVAL_DOCUMENT, outputDimensionality: 768
    │                ▼
    │            [Insert Invoice & Vector]  (Supabase — Insert)
    │                Inserts all fields + embedding vector
    │
    └── FALSE ─► [Update Invoice]  (Supabase — Update)
                     Updates updated_at + last_updated_by only
```

---

## Database Status

| Item | Status |
|---|---|
| pgvector extension | ✅ Installed |
| `invoices` table | ✅ Created with all columns |
| `embedding vector(768)` column | ✅ Present (nullable, populated by n8n at insert) |
| `metadata jsonb` column | ✅ Present (stores full Gemini JSON + storage_path) |
| `gmail_message_id` column | ✅ Present (unique, used as PDF filename) |
| `updated_at` / `last_updated_by` columns | ✅ Present |
| `search_invoices` RPC function | ✅ Created |
| HNSW partial index on `status = 'approved'` | ✅ Created |
| Unique constraint on `(invoice_number, vendor_name)` | ✅ Applied |
| `on_invoice_upload` storage trigger | ✅ Created |

**Project URL:** `https://jqjqupygxbpwsuajudsm.supabase.co`

---

## Why NOT the Supabase Vector Store Node

The n8n **Supabase Vector Store** node is built for LangChain's document convention (`content`, `metadata`, `embedding` columns). Our `invoices` table has structured columns. Using it would either fail or require a separate mapping table.

> Known n8n bug [#12906](https://github.com/n8n-io/n8n/issues/12906): the Vector Store node ignores the Table Name field and writes to `documents`.

**Node split used instead:**

| Operation | Node |
|---|---|
| Read PDF binary from storage | HTTP Request node |
| Extract structured fields from PDF | Google Gemini node (multimodal, 2.0 Flash) |
| Generate 768-dim embedding from `raw_text` | HTTP Request → Gemini Embedding API directly |
| Insert invoice row + embedding | Supabase node (regular) |
| Semantic search at query time | Next.js → `search_invoices` RPC (n8n not involved) |

---

## Node-by-Node Configuration

### Trigger: New Google Invoice (Gmail)

| Field | Value |
|---|---|
| Operation | Get All |
| Filter | `from:payments-noreply@google.com has:attachment after:2026/03/31` |
| Download Attachments | ✅ Yes |

### Supabase Storage Upload (HTTP Request)

| Field | Value |
|---|---|
| Method | POST |
| URL | `https://jqjqupygxbpwsuajudsm.supabase.co/storage/v1/object/invoices/{{ $('Trigger: New Google Invoice').item.json.id }}.pdf` |
| Auth | Supabase API credential |
| Header | `x-upsert: true` |
| Body | Binary — `attachment_0` |

This upload triggers the Supabase `on_invoice_upload` DB trigger, which POSTs to the n8n Webhook automatically.

### Webhook (entry point for processing path)

| Field | Value |
|---|---|
| Method | POST |
| Path | `0f9b3ffa-5f9f-4e54-82bc-a076a941b1a7` |
| Receives | `{ "file_path": "19d4930da9cc2485.pdf", "bucket_id": "invoices" }` |

### HTTP Request (fetch PDF from storage)

| Field | Value |
|---|---|
| Method | GET |
| URL | `https://jqjqupygxbpwsuajudsm.supabase.co/storage/v1/object/authenticated/invoices/{{ $json.body.file_path }}` |
| Auth | Supabase API credential |
| Response | File (binary) |

### Extract Invoice JSON (Google Gemini 2.0 Flash — multimodal)

| Field | Value |
|---|---|
| Resource | Document |
| Model | `models/gemini-2.0-flash` |
| Input type | Binary (`data`) |
| Prompt | Instructs Gemini to extract structured JSON matching `invoice_schema.json` |

Gemini reads the PDF binary directly — no text extraction step needed.

### Format Data for DB (Code node)

Parses `candidates[0].content.parts[0].text` from the Gemini response, extracts JSON, and builds:

```js
{
  vendor_name:    data.vendor_details?.name,
  invoice_number: data.billing_details?.invoice_number,
  invoice_date:   data.billing_details?.invoice_date,
  amount:         toNum(data.billing_details?.due_amount),
  tax:            toNum(data.billing_details?.tax_amount),
  currency:       data.billing_details?.currency?.toUpperCase(),
  raw_text:       "Vendor: X. Invoice #Y. Total: Z EUR. Items: ...",
  status:         "pending",
  storage_path:   "gmail_incoming_manual" | file_path,
  metadata:       <full cleanedJson object — stored in invoices.metadata>
}
```

### Find Existing Invoice (Supabase — Get Many)

| Field | Value |
|---|---|
| Table | `invoices` |
| Filter | `invoice_number = {{ $json.invoice_number }}` AND `vendor_name = {{ $json.vendor_name }}` |
| Always Output Data | ✅ Yes |
| On Error | Continue Regular Output |

### IF: Is Invoice New?

| Field | Value |
|---|---|
| Condition | `{{ $json.isEmpty() }}` is `true` |
| True branch | Generate Text Embeddings → Insert |
| False branch | Update Invoice (timestamps only) |

### Generate Text Embeddings (HTTP Request)

| Field | Value |
|---|---|
| Method | POST |
| URL | `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent` |
| Auth | Google Gemini (PaLM) API credential |
| Full Response | ✅ Yes (JSON) |
| Body | See below |

```json
{
  "model": "models/gemini-embedding-001",
  "taskType": "RETRIEVAL_DOCUMENT",
  "outputDimensionality": 768,
  "content": {
    "parts": [{ "text": "={{ $('Format Data for DB').item.json.raw_text }}" }]
  }
}
```

The embedding values are at: `$('Generate Text Embeddings').item.json.body.embedding.values`

### Insert Invoice & Vector (Supabase — Insert)

| Column | Expression |
|---|---|
| `status` | `={{ $('Format Data for DB').item.json.status }}` |
| `vendor_name` | `={{ $('Format Data for DB').item.json.vendor_name }}` |
| `invoice_date` | `={{ $('Format Data for DB').item.json.invoice_date }}` |
| `invoice_number` | `={{ $('Format Data for DB').item.json.invoice_number }}` |
| `amount` | `={{ $('Format Data for DB').item.json.amount }}` |
| `tax` | `={{ $('Format Data for DB').item.json.tax }}` |
| `currency` | `={{ $('Format Data for DB').item.json.currency }}` |
| `raw_text` | `={{ $('Format Data for DB').item.json.raw_text }}` |
| `embedding` | `={{ $('Generate Text Embeddings').item.json.body.embedding.values }}` |
| `metadata` | `={{ $('Format Data for DB').item.json }}` |

### Update Invoice (Supabase — Update, duplicate path)

| Field | Value |
|---|---|
| Filter | `id = {{ $('IF: Is Invoice New?').item.json.id }}` |
| `updated_at` | `={{ $now.format('yyyy-MM-dd') }}` |
| `last_updated_by` | `system_n8n` |

---

## Supabase Storage Trigger

The connection between the Gmail path and the processing path is a PostgreSQL trigger — not a direct n8n connection.

```sql
-- Fires after PDF upload to 'invoices' bucket
create trigger on_invoice_upload
  after insert on storage.objects
  for each row execute function handle_new_invoice_upload();

-- Calls n8n webhook with { file_path, bucket_id }
create or replace function handle_new_invoice_upload()
returns trigger language plpgsql security definer as $$
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

---

## How Vector Search Works at Query Time

n8n is not involved in search. When a user sends a chat message in the Next.js app:

1. `lib/gemini.ts → embedText(query)` calls `gemini-embedding-001` — 768-dim query vector
2. `app/api/chat/route.ts` calls `search_invoices` via supabase-js:

```ts
const { data } = await supabase.rpc('search_invoices', {
  query_embedding: embedding,
  match_count: 5,
})
```

3. Supabase uses the HNSW index (approved rows only) for cosine similarity search
4. Results feed into the Gemini `gemini-2.0-flash` response

Pending invoices are invisible to vector search until approved in the `/review` UI.
