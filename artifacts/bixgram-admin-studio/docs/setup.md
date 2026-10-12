# Bixgram Admin Studio setup

## Scope and connection boundary

Admin Studio is a separate application from Bixgram's Base44 app. It can read only the explicitly allowlisted Supabase tables and metadata fields listed below. Supabase being connected does not establish that Base44 uses that database. The dashboard never scrapes Base44 or stores Base44 login credentials.

The API checks Supabase's read-only PostgREST schema description before querying a table. An absent or inaccessible table is reported as missing/unavailable; the application does not run DDL, migrate data, seed records, or disable RLS. Counts are `null` if a table cannot be verified and are `0` only when a verified count query returns zero.

| Section / data | Current behavior |
| --- | --- |
| Profiles or users | Search and display safe account metadata; read-only |
| Reports and report reasons | Read safe identifiers/status/type/time and configured reason labels; no body, private message, or attachment content |
| Moderation and featured items | Public moderation metadata and public item references; read-only |
| Verification requests | Status and related identifiers only; no evidence or document content |
| Channel approvals | Queue metadata only; approving a row is not claimed to approve a Base44 channel |
| Daily prizes | Allowlisted prize metadata only; not a payment or entitlement integration |
| Live, platform analytics, platform restrictions, premium writes | Disconnected until the actual platform API and data contract are authorized |

Ban/unban, content decisions, verification decisions, channel approvals, and other platform-changing operations are intentionally disabled. A Supabase row update would not prove that a separate Base44 account or feature was changed.

## Configure secrets in Replit

In this Repl, open **Tools → Secrets** (or the workspace environment-variable interface) and set:

| Name | Purpose | Used by |
| --- | --- | --- |
| `SUPABASE_URL` | Project URL, e.g. `https://<project>.supabase.co` without `/rest/v1` | API and Auth bootstrap |
| `SUPABASE_ANON_KEY` | Public publishable/anon key | Browser Auth bootstrap and API Auth verification |
| `BIXGRAM_OWNER_EMAIL` | Exact, explicitly approved owner email | API only |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side privileged reads/admin-store writes, if configured | API server only |

Do not prefix these names with `VITE_`. The browser receives only the project URL and public anon key. Never add the service-role key to frontend variables, browser code, source control, logs, or API responses. The service role is used only by the API process; RLS must remain enabled. Every protected request still verifies Supabase Auth and checks owner/moderator permissions on the server.

If `BIXGRAM_OWNER_EMAIL` is absent or invalid, owner access is denied. Do not create a shared password or bypass. Supabase Auth must report a verified email matching the configured owner. Keep public account creation disabled and add the deployed Admin Studio URL to Supabase Auth's allowed redirect URLs.

After changing a secret, restart the API Server and web workflow so they load the updated environment. Never print secret values while debugging.

## Data and authorization model

- Protected API routes verify the Supabase bearer token independently and authorize the requested permission server-side.
- The owner is matched to the configured email. Moderators are individually approved and receive only explicit permissions; they cannot appoint moderators or access owner-only audit functions.
- The browser has no service-role credential. There are no API routes for arbitrary table names, user-by-ID inspection, E2EE messages, or decrypted attachments.
- The API selects only fixed, reviewed metadata columns. If a table's columns cannot be verified, the request returns unavailable instead of selecting all fields.
- Keep RLS enabled. Do not solve permission errors by disabling it or broadening client access.

Admin Studio's `bixgram_admin_moderators` and `bixgram_admin_audit_logs` are separate administrative records, not Bixgram social data. Review `proposed-admin-schema.sql` before applying any additive DDL; the app does not run it automatically.

## Audit and E2EE boundaries

Sanitized server-observed admin events include actor identity when known, action, affected record ID where relevant, result, and server timestamp. Passwords, bearer tokens, service keys, private keys, arbitrary request bodies, report text, and E2EE content must never be logged. Sign-in failures wholly inside Supabase Auth are not claimed as Admin Studio audit events. If an audit table is unavailable, the UI/API report that state; this does not imply an event was durably written.

Admin Studio does not contain a private conversation browser, master decryption key, decryption backdoor, private encryption keys, or decrypted private attachments. HTTPS or database/server-side encryption is not described as E2EE.

## Base44 API and deployment

Base44 remains a separate, unconnected system. Future integration requires a documented, authorized Base44 API or backend function, its real schemas and operation contracts, least-privilege access, and tests for platform-side effects. Until then, the corresponding controls remain unavailable.

The frontend can be built from `artifacts/bixgram-admin-studio` for Vercel using the included `vercel.json`. It is a static frontend; the secure API must remain separately hosted. For Vercel, configure the public build variable `VITE_API_BASE_URL` to the API origin. On the API host, set `ADMIN_STUDIO_ORIGINS` to the exact comma-separated frontend origin(s); cross-origin access is denied when not allowlisted. Do not put service-role credentials in Vercel frontend variables.

The install manifest is configured, but the 192px, 512px, and Apple touch icons are pending the owner's gold B image. Do not publish the manifest as fully installable until those source-derived icon files have been added.

## Verify locally

```sh
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/bixgram-admin-studio run typecheck
pnpm run typecheck
```

Automated tests check protected-route denial, role and permission enforcement, fixed data-source allowlists, no arbitrary IDs/table names, no E2EE content response fields, no secret disclosure, null metrics for disconnected tables, and empty results without synthetic records. Tests do not prove Base44 is connected or that an unsupported platform write works.
