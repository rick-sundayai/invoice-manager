# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Start dev server (Turbopack by default)
npm run build    # Production build (Turbopack by default)
npm run start    # Start production server
npm run lint     # Run ESLint (uses `eslint` CLI, not `next lint`)
npm test         # Run Jest tests (node environment, ts-jest)
npx jest lib/chat.test.ts  # Run a single test file
```

## Stack

- **Next.js 16.2.2** — App Router only. Breaking changes from v15; read `node_modules/next/dist/docs/` before writing code.
- **React 19.2** — includes View Transitions, `useEffectEvent`, Activity
- **TypeScript 5** — strict mode
- **Tailwind CSS v4** — configured via `@import "tailwindcss"` in CSS, `@theme inline` for custom tokens; no `tailwind.config.js`; uses `@tailwindcss/postcss`

## Next.js 16 Breaking Changes

**Always read `node_modules/next/dist/docs/` for current APIs before writing code.**

### Async Request APIs (fully breaking)
`cookies()`, `headers()`, `draftMode()`, `params`, and `searchParams` are now **async-only** — synchronous access was removed:

```tsx
// Correct in v16
export default async function Page(props: PageProps<'/blog/[slug]'>) {
  const { slug } = await props.params
  const query = await props.searchParams
}
```

Run `npx next typegen` to generate `PageProps`, `LayoutProps`, `RouteContext` type helpers.

### `middleware` → `proxy`
The `middleware.ts` file/export is deprecated. Rename to `proxy.ts` with a named export `proxy`. The `edge` runtime is NOT supported in `proxy` (uses `nodejs`). Keep using `middleware.ts` only if you need the edge runtime.

### Turbopack is now default
`next dev` and `next build` use Turbopack by default. Custom `webpack` configs in `next.config.ts` will cause build failures unless you pass `--webpack` flag.

### Caching APIs
- `unstable_cacheLife` → `cacheLife`, `unstable_cacheTag` → `cacheTag` (stable, no prefix needed)
- New APIs: `updateTag` (read-your-writes, Server Actions only), `refresh` (refresh client router from Server Action)
- PPR now uses `cacheComponents: true` in `next.config.ts` instead of `experimental.ppr`

### ESLint
Uses `eslint` CLI directly (not `next lint`). Config is in `eslint.config.mjs` (flat config format).

### `next/image` local images with query strings
Requires `images.localPatterns[].search` config to use query strings with local images.

## Project: InvoiceBrain

Personal invoice management tool. n8n extracts financial data from Gmail PDFs and writes directly to Supabase (no Next.js webhook). The app provides a human-in-the-loop review inbox and a Gemini-powered financial chat interface.

**Design spec:** `docs/superpowers/specs/2026-04-04-invoicebrain-design.md`  
**Implementation plan:** `docs/superpowers/plans/2026-04-04-invoicebrain.md`

### Architecture

- **No auth for MVP.** n8n inserts rows with `status='pending'`; the app only flips status to `'approved'`.
- **Reusability principle:** `lib/` and `components/` contain no invoice-specific logic. Feature logic lives in `app/review/` and `app/chat/`.
- **Hybrid search in chat:** embed query → pgvector cosine similarity on approved rows → optional SQL aggregate for counts/totals → Gemini `gemini-2.0-flash` for final response.
- **Partial HNSW index** on `status = 'approved'` — pending rows are invisible to vector search at the DB level.

### Project Structure

```
app/
  layout.tsx          # Root layout with dark sidebar shell
  page.tsx            # Redirect → /review
  review/
    page.tsx          # Server component — pending invoices table
    [id]/page.tsx     # Server component + server action — edit + approve
  chat/
    page.tsx          # Chat shell (chat-window + chat-results)
  api/
    approve/[id]/route.ts   # PATCH — flip status to 'approved'
    chat/route.ts           # POST — embed → vector search → Gemini

lib/
  supabase.ts         # Server-side Supabase client factory (service role key)
  gemini.ts           # Gemini client: embedText() + generateResponse()
  chat.ts             # Pure utils: isAggregativeQuery, parseDataBlock

types/
  invoice.ts          # Invoice, InvoiceRow, InvoiceStatus types

components/
  sidebar.tsx         # Left nav with pending badge
  invoice-table.tsx   # Shadcn table + approve buttons (client)
  chat-window.tsx     # Conversation thread (client)
  chat-results.tsx    # Structured data panel (client)
```

### AI

- Embeddings: Gemini `gemini-embedding-001` — 768 dimensions
- Chat: Gemini `gemini-2.0-flash`
- Package: `@google/generative-ai`

> **Note:** `lib/gemini.ts` currently calls `text-embedding-004` (line 16) — needs updating to `gemini-embedding-001`.

### Chat API Contract

`POST /api/chat` accepts `{ message: string }` and returns `{ text: string, data: DataBlock | null }`.

Gemini is prompted to embed structured data inside `<data>...</data>` XML tags in its response. `lib/chat.ts` parses this out:
- `parseDataBlock(text)` — extracts `DataBlock` from `<data>` tag
- `stripDataBlock(text)` — removes the `<data>` tag, leaving clean prose
- `isAggregativeQuery(query)` — detects spend/total questions to trigger SQL aggregate

`DataBlock` shape: `{ items: [{vendor, amount, currency}], total?, currency? }`

### Database (Supabase + pgvector)

- `invoices` table with `embedding vector(768)` column
- `status` is a PostgreSQL enum: `'pending' | 'approved'`
- `embedding` is nullable — n8n populates it via direct HTTP call to `gemini-embedding-001` at insert time (not using the Supabase Vector Store node)
- `metadata` jsonb — stores full Gemini extraction JSON; `gmail_message_id`, `updated_at`, `last_updated_by` columns also present
- `InvoiceRow = Omit<Invoice, 'embedding'>` — use this type for UI components that never need the vector
- Tests only cover pure functions in `lib/` (no Next.js or Supabase mocking). `lib/chat.test.ts` is the only test file.
- Use `SUPABASE_SERVICE_ROLE_KEY` server-side (never expose to client)

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
```

### UI

- Shadcn/UI (Default style, Slate base color, CSS variables on)
- Dark sidebar shell layout — `/review` and `/chat` routes

## Tailwind v4 Notes

- No config file — configured entirely in CSS via `@import "tailwindcss"` and `@theme inline {}`
- Custom design tokens go in the `@theme inline {}` block in `globals.css`
- The `tailwind-v3-css.md` guide in `node_modules/next/dist/docs/01-app/02-guides/` documents migration from v3 patterns
