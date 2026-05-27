# myblog_front

Astro 5 blog frontend with React islands. Handles content rendering, post writing, music review submission, and search.

## Stack

- **Framework**: Astro 5, React 19
- **Styling**: Tailwind CSS v4, DaisyUI
- **Language**: TypeScript (strict mode)
- **Package manager**: pnpm
- **Search**: Pagefind (static search index built at `pnpm build`)

## Structure

```
src/
├── lib/
│   ├── api.ts          ← safeFetch, addCategory, fetchMetrics, apiFetch (auth-aware)
│   └── auth.ts         ← getAccessToken, goLogin
├── scripts/
│   ├── write/
│   │   ├── api.ts      ← PostPayload type, savePost, publishToGit, fetchCategories
│   │   └── index.ts    ← Write page logic (form submit, rating validation)
│   └── review/
│       └── index.ts    ← Review page logic (rating-only submit)
├── pages/              ← Astro page routes
├── components/         ← Astro + React components
└── content.config.ts   ← Content collections schema
```

## API Conventions

- All backend calls go through `src/lib/api.ts` or `src/scripts/write/api.ts`.
- Backend base URL: `import.meta.env.PUBLIC_BACKEND_API_URL` — all paths must include the `/api` prefix (e.g. `/api/categories`, not `/categories`).
- Publish base URL: `import.meta.env.PUBLIC_PUBLISH_BASE_URL`.
- `apiFetch` injects the Bearer token automatically and redirects to login on 401.

## Key Types

`PostPayload` (`src/scripts/write/api.ts`):
- `rating: number | null` — `0–5`, null if unrated

## Rating Rules

- Backend validates `rating` as `ge=0, le=5`.
- Client-side validation must reject values `> 5`. Do not use `> 10`.

## Plugin

The `frontend-design` plugin is active in this repo — it auto-applies production-grade aesthetics to all frontend work. No explicit invocation needed.

## Hard Rules

- **Never use raw `fetch()` for authenticated requests** — always use `apiFetch` from `src/lib/api.ts`.
- **Never hardcode API paths without the `/api` prefix**.
- **Never work directly on `main`** — branch from `main`, PR back.

## Running Locally

```bash
pnpm install
pnpm dev          # http://localhost:4321
pnpm build        # astro build + pagefind index
```

Required env (`.env` or `astro.config.ts` env schema):
```
PUBLIC_BACKEND_API_URL=http://localhost:8000
PUBLIC_PUBLISH_BASE_URL=http://localhost:9000
```

## Verification

```bash
pnpm lint
# TypeScript check:
pnpm exec astro check
```
