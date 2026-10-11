# Bixgram Admin Studio setup

## Current connection state

This project is separate from the existing Bixgram/Base44 application. No Base44 API or Supabase project has been connected, and no Bixgram schema was inspected because no authorized connection details were supplied. The app does not read, write, or migrate Bixgram data. Platform sections stay disconnected and metrics remain unavailable until an authorized integration is configured and verified.

## Configure Supabase safely

In this Replit project's **Tools → Secrets** (or the project environment-variable interface), add:

| Name | Purpose | Used by |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase project URL | Server and public Auth bootstrap |
| `SUPABASE_ANON_KEY` | Supabase publishable/anon key | Server-side Auth verification and public Auth bootstrap |
| `BIXGRAM_OWNER_EMAIL` | The exact owner email approved to administer this Studio | Server only |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional privileged server connection for the moderator and audit stores | API server only |

Do not add a `VITE_` prefix to these names. The app returns only the Supabase URL and public anon key for the Auth client; it never returns the owner email or service-role key. Never put the service-role key in frontend variables, browser code, source control, logs, or API responses. The service-role key is not needed for Supabase email/password sign-in; without it, moderator and audit-store reads are marked disconnected.

Owner access is denied when `BIXGRAM_OWNER_EMAIL` is missing or invalid. Set it to the explicitly approved owner address; no address is prefilled. Do not configure a shared admin password. Supabase Auth must confirm the user's email before the API will authorize that identity.

Configure Supabase Auth's permitted redirect URLs to include the Admin Studio's deployed URL after deployment. Keep email/password sign-in enabled for the intended owner. Do not enable public account creation for this private tool.

## Admin-only tables and RLS

The existing Supabase schema has not been inspected. The API checks whether the two expected admin tables are present using read-only metadata-style `select ... limit 0` requests. A missing or inaccessible table is reported; the app never runs DDL or silently falls back to a different database.

After connecting to the intended Supabase project, inspect its schema read-only and review `proposed-admin-schema.sql` with the database owner. Apply a reviewed, additive migration manually only if those tables are actually absent and their names do not conflict. The file contains no seed data and is never run by the app. Keep RLS enabled and direct `anon`/`authenticated` access revoked. The API's service-role client is server-only; each protected request still verifies the Supabase user and checks owner/moderator authorization in server code.

The proposed store is only for Admin Studio moderator approvals, permissions, and sanitized security events. It is not a substitute for Bixgram's Base44 data and does not contain social content or messages.

## Base44 integration

Base44 is intentionally marked **Not connected yet**. Future access requires a documented, authorized Base44 API or backend function, its actual data contract, least-privilege access, and a review of user/content identifiers and allowed actions. Do not scrape private dashboards or store Base44 login credentials. No platform writes are enabled in this phase.

## Privacy and audit behavior

- No E2EE messages, attachments, encryption keys, or decrypted content are requested, stored, logged, or exposed.
- Successful visits to the protected session endpoint and server-observed authorization failures are audit candidates when the audit table is available.
- Supabase sign-in failures that occur wholly inside the Auth provider are not claimed as Admin Studio audit events.
- Audit events contain actor identity when known, action, affected identifier when relevant, result, and server-generated timestamp. No passwords, bearer tokens, service keys, message bodies, or arbitrary request payloads are stored.
- User management, reports, public-content moderation, Channels, Live, verification, monetization, analytics, moderator writes, and platform restrictions remain read-only/disconnected until supported APIs and schemas are confirmed.

## Verification

Run:

```sh
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/bixgram-admin-studio run typecheck
pnpm run typecheck
```

The security tests cover protected API denial, role and permission checks, absent ID-based/content routes, absent secret disclosure, null metrics when disconnected, and explicit disconnected integration states. They do not prove a real Supabase or Base44 project is connected.
