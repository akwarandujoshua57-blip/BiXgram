# Bixgram Admin Studio

A standalone, fail-closed admin foundation for the existing Bixgram platform. It does not modify the separate Base44 app or its data.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/api-server run test` — run the server authorization/security tests
- `pnpm --filter @workspace/bixgram-admin-studio run dev` — run the admin web app
- `pnpm --filter @workspace/bixgram-admin-studio run typecheck` — check the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required Supabase env when ready: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BIXGRAM_OWNER_EMAIL`
- Optional server-only Supabase env for moderator/audit stores: `SUPABASE_SERVICE_ROLE_KEY`
- Configure these values through Replit's environment-variable interface; see `artifacts/bixgram-admin-studio/docs/setup.md`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Auth/data: Supabase Auth + Supabase PostgREST, both disconnected until configured

## Where things live

- Frontend: `artifacts/bixgram-admin-studio`
- Protected admin API: `artifacts/api-server/src/routes/admin.ts`
- Server authorization and permission allowlist: `artifacts/api-server/src/lib/admin-access.ts`
- Runtime Supabase adapter: `artifacts/api-server/src/lib/admin-service.ts`
- OpenAPI source of truth: `lib/api-spec/openapi.yaml`
- Setup and future Base44 contract notes: `artifacts/bixgram-admin-studio/docs/setup.md`
- Review-only proposed admin tables: `artifacts/bixgram-admin-studio/docs/proposed-admin-schema.sql`

## Architecture decisions

- No Base44 API or Supabase schema is assumed or modified; unsupported platform sections remain disconnected.
- The owner is defined by server-only `BIXGRAM_OWNER_EMAIL`; no client-supplied role or shared password grants access.
- All protected API requests validate the Supabase token with Supabase Auth and resolve moderator grants on the server.
- The service-role key is limited to server-side moderator/audit data access and never enters browser code.
- The Studio has no E2EE message, attachment, or key browsing route.

## Product

Provides a responsive admin shell, verified Supabase session foundation, owner/moderator authorization model, real integration readiness, and an audit-log foundation. Platform administration remains unavailable until supported APIs and schemas are connected.

## User preferences

- Keep Bixgram Admin Studio separate from the existing Bixgram/Base44 project and its data.
- Do not invent users, content, messages, statistics, credentials, or connected integrations.
- Do not expose E2EE plaintext or private encryption keys.

## Gotchas

- Never apply the proposed admin SQL automatically; inspect the intended Supabase schema first.
- Run `pnpm --filter @workspace/api-server run test` after auth/permission changes.
- A Supabase anon key is public configuration; the service-role key and owner email remain server-side.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
