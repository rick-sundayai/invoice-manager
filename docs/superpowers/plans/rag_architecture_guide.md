# Modern RAG Systems: Architecture & Implementation

A modern **Retrieval-Augmented Generation (RAG)** system enhances Large Language Models (LLMs) by retrieving relevant external knowledge to ground responses, significantly reducing hallucinations and improving factual accuracy. 

Based on your current tech stack, this guide explains how to build a production-grade RAG system using **n8n** for orchestration, **Supabase (pgvector)** for the vector store, **Next.js** for the frontend, and standard LLM APIs.

---

## 1. Core Architecture

The core architecture of a RAG pipeline follows two distinct phases: **Ingestion** and **Retrieval + Generation**.

```mermaid
graph TD
    %% Ingestion Pipeline
    subgraph Ingestion Pipeline
        A[Raw Documents] --> B[Chunking / Splitting]
        B --> C[Embedding Model]
        C --> D[(Vector Database)]
    end

    %% Retrieval Pipeline
    subgraph Retrieval & Generation Pipeline
        E[User Query] --> F[Embed Query]
        F --> G{Hybrid Search}
        G -->|Dense + Sparse| D
        D -->|Top K Results| H[Reranker]
        H --> I[Prompt Augmentation]
        I --> J[LLM]
        J --> K[Final Output]
    end
    
    style Ingestion Pipeline fill:#1a1a2e,stroke:#333
    style Retrieval & Generation Pipeline fill:#16213e,stroke:#333
```

> [!NOTE]
> **Dense Search** relies on vector embeddings matching semantic meaning, while **Sparse Search** (like BM25) relies on exact keyword matching. Modern systems combine both.

---

## 2. Component Implementation Details

### A. Data Ingestion (Chunking & Embedding)
Before data can be searched, it must be properly formatted and stored.

- **Chunking Strategy**: Split documents into semantic units (e.g., 512-1024 tokens) to preserve context. Use strategies like fixed-size with overlap (20-30%) or recursive text splitting. 
- **Embeddings**: Convert chunks into vectors using models like OpenAI's `text-embedding-3-small` or `text-embedding-3-large`.

### B. Vector Store (Supabase + pgvector)
Supabase acts as your primary knowledge base.

> [!IMPORTANT]
> You must enable the `pgvector` extension in your Supabase project before creating vector columns.

**Schema Example**:
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
  id uuid primary key default gen_random_uuid(),
  content text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  embedding vector(1536) -- 1536 is standard for OpenAI embeddings
);

-- Optimize for fast Approximate Nearest Neighbor (ANN) search
CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops);
```

### C. Retrieval Strategies (Hybrid Search)
To maximize accuracy, do not rely on dense vector search alone. 

1. **Dense Search**: Good for conceptual matching. (`ORDER BY embedding <=> query_emb`)
2. **Sparse Search**: Good for exact names, acronyms, or IDs. (PostgreSQL `tsvector`)
3. **Hybrid Search**: Combine both and use an algorithm like Reciprocal Rank Fusion (RRF) to merge the results.
4. **Reranking**: An optional (but highly recommended) step where you pass the combined top results through a Cross-Encoder or an LLM to assign a final relevance score.

---

## 3. Orchestration with n8n

n8n acts as the "brain" connecting your Next.js app to your database and LLMs. You will typically build two main workflows.

### Workflow 1: The Ingestion Pipeline
This workflow processes raw data into your vector store.
1. **Trigger**: HTTP Webhook or Schedule.
2. **Document Extract**, **Text Splitter**: Chunks the text.
3. **Embeddings Node**: Calls OpenAI to generate vectors.
4. **Supabase Node**: Upserts the text, metadata, and vectors into your `documents` table.

> [!TIP]
> Use n8n's new **AI Nodes** (Advanced AI -> Vector Store -> Insert) which wraps chunking, embedding, and insertion into a single streamlined process.

### Workflow 2: The Action/Query Pipeline
This workflow handles the live conversation.
1. **Trigger**: Webhook from from your Next.js frontend.
2. **AI Agent / Chain**: Accepts the query.
3. **Retrieval**: Queries the Supabase vector store (using n8n's Postgres or Supabase Vector Store nodes).
4. **LLM Generation**: Feeds the context and the prompt to the Chat Model.
5. **Respond**: Returns the LLM output to the webhook response.

---

## 4. Frontend Integration (Next.js)

Your Next.js app will provide the chat UI and securely communicate with n8n.

Use the Next.js **App Router** and the **Vercel AI SDK** to stream responses to the user.

```typescript
// app/api/chat/route.ts
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  const { messages } = await req.json();
  const latestQuery = messages[messages.length - 1].content;
  
  // Call your n8n workflow webhook
  const res = await fetch('YOUR_N8N_WEBHOOK_URL', {
    method: 'POST',
    body: JSON.stringify({ query: latestQuery }),
    headers: { 'Content-Type': 'application/json' },
  });
  
  // Depending on if n8n returns streaming text or application/json,
  // return the appropriate response.
  return new Response(res.body);
}
```

> [!WARNING]
> Do not expose n8n webhooks directly to the client browser without authentication. Proxifying the request through your Next.js API route ensures you can add rate limiting, Supabase authentication checks, and logging before hitting n8n.

---

## Best Practices Checklist

- [ ] **Evaluate Chunking**: Test different text chunking strategies based on your specific document types (emails vs long PDFs need different handling).
- [ ] **Track Metadata**: Always store useful metadata (e.g., `user_id`, `document_source`, `timestamp`) alongside your vectors to allow for pre-filtering before the vector search.
- [ ] **Protect Endpoints**: Treat your n8n RAG webhooks as secure APIs. Validate inputs via Next.js first.
- [ ] **Iterative RAG**: Start with Naive RAG (just dense search). If accuracy is low, add metadata filtering. If it's still low, implement Hybrid Search and a Reranker.
