# Future Base44 integration boundary

## Current state

Bixgram currently runs in Base44. Admin Studio is a separate project. No Base44 account, database, schema, API, or backend function is connected or assumed to be shared with Supabase. The current platform adapter is intentionally absent: the API reports `not_connected`, returns no platform records, and accepts no platform mutations.

## What is required before connecting

1. Identify an official, owner-authorized Base44 API or backend function for the exact operation. Confirm its documented authentication method and supported scopes. Do not scrape private dashboards or store Base44 login credentials.
2. Inspect only the relevant existing schema and API contract using authorized read-only access. Confirm data ownership, stable record IDs, field meanings, and whether reported-content review can be privacy preserving. Do not run migrations or alter Base44 tables.
3. Agree on a least-privilege request and response contract. The browser must call Admin Studio's server endpoint; only the server adapter may call the authorized Base44 API. Keep any integration credential in server-only Replit Secrets.
4. For each protected operation, re-check the Supabase identity, owner/moderator status, and the specific permission on that request. Validate identifiers and payloads against the documented contract. Do not trust a browser role or permission list.
5. Keep unsupported operations disabled. Introduce writes only after the source API, confirmation flow, expected result, failure handling, and corresponding audit action are implemented and tested.

## Scoping and privacy

- A first integration should be read-only and limited to one approved use case; never assume access to all Base44 records.
- Do not transmit or return private E2EE plaintext, attachments, encryption keys, or decrypted content. A user-submitted report may be reviewed only if the actual messaging design supports voluntary, privacy-preserving submission.
- Prefer minimum metadata needed for account or report review. Do not log raw request bodies, tokens, private message content, or unnecessary personal data.
- A future platform adapter belongs behind the API service boundary. It must return documented, validated data only; it must not expose an upstream token or call Base44 directly from browser code.
- Supabase remains the Admin Studio authentication and (after a reviewed manual setup) moderator/audit store. It must not be treated as Bixgram's data store unless the owner later establishes that relationship explicitly.

## Operations that remain unavailable

Until a supported schema/API is verified, Admin Studio cannot search users, view account status, retrieve reports or public content, manage Channels or Live, review verification requests, read monetization/analytics data, or change platform accounts/content. Owner moderator approval and revocation endpoints are also not implemented yet; the moderator role is denied unless a real, reviewed approval record is available to the server.

The security test suite uses injected test services to verify fail-closed authorization and disconnected states. It does not claim that a Base44 or Supabase integration is live.
