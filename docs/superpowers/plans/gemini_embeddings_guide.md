# Using Google Gemini API for Embeddings

The Google Gemini API provides embedding models that convert text to vectors. InvoiceBrain uses **`gemini-embedding-001`** (768 dimensions), called via direct HTTP Request in n8n.

> **Note:** The older `text-embedding-004` was superseded by `gemini-embedding-001` in early 2026. Use `gemini-embedding-001` for all new work.

---

## Endpoint Format

```
https://generativelanguage.googleapis.com/v1beta/models/{MODEL_ID}:{METHOD}
```

- **MODEL_ID:** `gemini-embedding-001`
- **METHOD:** `embedContent` (single) or `batchEmbedContents` (batch)
- **Auth header:** `x-goog-api-key: YOUR_API_KEY`

---

## 1. Single Text Embedding

```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent" \
-H "Content-Type: application/json" \
-H "x-goog-api-key: YOUR_API_KEY" \
-d '{
  "model": "models/gemini-embedding-001",
  "taskType": "RETRIEVAL_DOCUMENT",
  "outputDimensionality": 768,
  "content": {
    "parts": [{ "text": "Your text here" }]
  }
}'
```

**taskType values:**
- `RETRIEVAL_DOCUMENT` — text going into the database (used in n8n ingestion)
- `RETRIEVAL_QUERY` — text from user search input (used in Next.js chat route)
- `SEMANTIC_SIMILARITY` — general comparison

**Response path:** `embedding.values` — array of 768 floats

---

## 2. Batch Embedding (Multiple Chunks)

```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents" \
-H "Content-Type: application/json" \
-H "x-goog-api-key: YOUR_API_KEY" \
-d '{
  "requests": [
    {
      "model": "models/gemini-embedding-001",
      "taskType": "RETRIEVAL_DOCUMENT",
      "content": { "parts": [{ "text": "Chunk 1" }] }
    },
    {
      "model": "models/gemini-embedding-001",
      "taskType": "RETRIEVAL_DOCUMENT",
      "content": { "parts": [{ "text": "Chunk 2" }] }
    }
  ]
}'
```

InvoiceBrain doesn't chunk — one embedding per invoice's `raw_text` field.

---

## 3. n8n HTTP Request Node Configuration

This is the exact configuration used in the **Generate Text Embeddings** node:

| Field | Value |
|---|---|
| Method | POST |
| URL | `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent` |
| Auth | Google Gemini (PaLM) API credential (`predefinedCredentialType: googlePalmApi`) |
| Full Response | ✅ Yes (`fullResponse: true`, `responseFormat: json`) |

**JSON Body:**
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

> **Important:** The key is `outputDimensionality` (camelCase) in the JSON body, not `output_dimensionality`. Use camelCase to match the Gemini API spec.

**Accessing the result in subsequent nodes:**
```
$('Generate Text Embeddings').item.json.body.embedding.values
```

The `body` wrapper exists because `fullResponse: true` is set — the full HTTP response object is returned, with the actual Gemini payload under `.body`.

---

## 4. Next.js Usage (Query-time Embeddings)

In `lib/gemini.ts`, the app embeds user chat queries for vector search:

```ts
import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)

export async function embedText(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' })
  const result = await model.embedContent({
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_QUERY',  // query, not document
  })
  return result.embedding.values
}
```

The 768-dim query vector is passed to `search_invoices` RPC for cosine similarity against approved invoice embeddings.
