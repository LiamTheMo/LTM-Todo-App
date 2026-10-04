# Phase 10 — Backend, Authentication & Sync Protocol
**Checkpoint:** `v2.01`
**Target release:** `v3.00`

## Objective

Introduce a secure account-backed synchronization service without changing local-first behavior or blocking normal task/calendar use on network availability. Establish and test the wire protocol before the supported web/PWA client depends on it.

## Scope

- Cloudflare Worker API runtime, D1 schema/migrations, per-account Durable Object coordination, managed OIDC authentication, account/session lifecycle, server-side authorization, versioned API and schema negotiation.
- Incremental push/pull protocol with stable client entity IDs, base revisions, server-assigned revisions, opaque per-account cursors, idempotency keys, and tombstone propagation.
- Validation and resource limits for every request; rate/abuse controls appropriate to a personal productivity application; privacy-preserving operational logs.
- A threat model, architecture decision record, machine-readable protocol fixtures, and deterministic API/authorization test harness.

## External calendar feed design
Define the v3 data model and threat boundary for read-only HTTPS iCalendar (ICS) subscriptions before implementation. Subscription records are owned by an authenticated account and reference a source URL that may function as a bearer secret. Specify encryption at rest, authorization, redaction from logs, refresh policy, cache validators, source identity and cancellation handling.

The feed fetcher must reject unsafe schemes and destinations, revalidate redirect targets, prevent access to private/link-local networks, and enforce response-size, timeout and refresh-rate limits. Choose a supported ICS feature set for time zones, recurrence, cancellations and malformed feeds. The initial design is one-way and read-only; Google-account OAuth and write-back are out of scope.

## Architecture decision

Use the existing Cloudflare Worker deployment as the API runtime. Keep notification data in its current D1 database and use a separate D1 database for sync and attachment metadata. Serialize sync operations through one SQLite-backed Durable Object per verified account. Use a managed OpenID Connect issuer for interactive sign-in. The backend validates access tokens and derives the account principal only from verified issuer claims. Provider-specific endpoints and secrets are deployment configuration, never bundled in clients.

The specific OIDC provider and Cloudflare resources must be selected and provisioned before production configuration. Keep the API contract provider-neutral. See [ADR 0003](../adr/0003-v3-sync-backend.md).

## Threat model

Protected assets include task/calendar content, account identity, sessions/refresh credentials, change history, and attachment bytes. Trust boundaries are the unauthenticated network, the authenticated but untrusted client, the Worker, D1, the per-account Durable Object, R2, and the identity provider. Assume clients can forge every payload field and replay requests; devices can be lost; tokens can expire or leak; requests can be duplicated, reordered, oversized, or interrupted; and a user can attempt cross-account ID guessing.

Required controls:

- Validate signature, issuer, audience, expiry, not-before, and allowed signing algorithm using provider JWKS; handle key rotation and fail closed when token verification cannot be established.
- Derive account ID from the verified subject and enforce ownership/membership in every database query or transaction. Never accept an owner/account ID from the request as authority.
- Use HTTPS only. Keep web refresh credentials in secure, HttpOnly, SameSite cookies when cookie sessions are used; keep native credentials in platform secure storage. Protect state-changing cookie-authenticated requests against CSRF and reject untrusted origins.
- Bound request bodies, batches, entity sizes, cursor lengths, pagination, and response sizes. Validate entity schemas server-side and use parameterized SQL.
- Make mutations transactional and idempotent. Do not reveal another account's existence, data, cursor, or conflict payload.
- Redact request bodies, titles, notes, tokens, authorization headers, and connection strings from logs. Keep secrets in deployment secret stores.
- Add per-account and per-network throttling and generic error responses. Avoid unbounded retry or expensive parsing paths.

## Protocol v1

### Entity envelope

Each syncable record is scoped to the authenticated account and contains `entityType`, stable UUID `entityId`, integer `baseRevision`, `operation` (`upsert` or `delete`), `clientMutationId` (UUID), `clientSchemaVersion` (currently `4`, matching the local web schema), and a validated versioned `payload` for upserts. Delete is a tombstone mutation and has no content payload. `createdAt` and client `updatedAt` may be preserved as descriptive metadata but do not determine conflict order. Clients order a batch so newly created referenced projects, sections, tags, calendars, tasks, and templates precede dependent entities; the server validates references inside the transaction.

### Push

`POST /api/v1/sync/push` accepts at most 12 mutations (each entity is at most 128 KB; total request is at most 1 MB). In one database transaction, the service validates every mutation and checks a unique idempotency key scoped to account. A repeated `clientMutationId` returns its original result. New mutations must match the server's current entity revision (revision zero means no server record). Accepted changes receive a monotonically increasing server revision and server timestamp, update the entity snapshot/tombstone, append to the account change journal, and store the idempotent response. A stale base revision produces an explicit conflict result with only that account's current authoritative record. A malformed batch is rejected without partial writes. Responses are capped at 2 MB; pull pages are limited to 12 records to keep worst-case payloads bounded.

### Pull

`GET /api/v1/sync/changes?cursor=<opaque>&limit=<bounded>` returns changes strictly after the supplied account-scoped cursor, including tombstones. The response carries the next opaque cursor, protocol/schema version, and `hasMore`. A missing cursor means the initial snapshot. Cursors are server-issued and must not be interpreted by clients. Pagination ordering uses the server journal sequence, never client clocks.

### Schema and errors

Negotiate protocol version with an explicit header and return a structured unsupported-version response before applying writes. Responses use stable machine-readable error codes and `Cache-Control: no-store`. Authentication, authorization, validation, stale revision, rate-limit, retryable server failure, and expired/invalid cursor outcomes are distinct. No endpoint returns data for a different principal.

### Compaction and retention

Do not compact journal entries or tombstones until active registered devices have advanced beyond them or have been explicitly retired, and the documented retention window has elapsed. The implementation must reconcile inactive-device recovery with the existing 31-calendar-day local history purge and Phase 12 export/restore before choosing exact server retention durations. Expired history must never be silently resurrected by a stale device.

## Database model

Use account-owned D1 rows with composite keys/constraints: `sync_accounts` (identity-provider subject), `sync_devices` (registered client and cursor/retirement state), `sync_entities` (account, entity type, UUID, server revision, validated JSON text payload or tombstone, server timestamps), `sync_journal` (account sequence, entity reference, revision, tombstone/payload), and `sync_idempotency` (account, mutation UUID, response). Add indexes for account-scoped entity lookup and ordered journal pagination. Use Wrangler-managed D1 migrations and a Durable Object to serialize each account's operations. Do not store secrets or duplicate user credentials.

## Tests
Feed-security tests must cover SSRF/private-network attempts, redirects, oversized/slow responses, unauthorized subscription access, URL redaction and refresh throttling.

Start with protocol fixtures and service-level tests before wiring clients:

- account isolation for every endpoint, including guessed entity IDs and cursors;
- invalid signature, issuer, audience, expiry, not-before, algorithm, key rotation, missing principal, and revoked/expired session behavior;
- idempotent retry and duplicate delivery, repeated batch after timeout, and interrupted transaction with no partial writes;
- out-of-order, stale base revision, same-record concurrent update, tombstone-vs-update, and revision-zero create races;
- cursor pagination, invalid/expired/account-mismatched cursors, bounded limits, and stable ordering;
- malformed or oversized payload, unknown schema, invalid relationships, rate behavior, and redacted logs;
- database migration from empty and prior versions, plus rollback/compatibility checks;
- retryable database outage behavior without changing local client data.

## Acceptance criteria

- The threat model and ADR are reviewed before API implementation.
- Protocol schemas, fixtures, and deterministic protocol/authorization tests exist before clients depend on the endpoints.
- Account authorization is enforced by the server and proven with negative cross-account tests.
- Retries are idempotent, stale revisions are explicit, cursors are opaque/account-scoped, and tombstones survive until safe compaction.
- The local app remains usable offline and while the server is unavailable.
- Secrets and user content do not appear in source control, client bundles, or routine logs.
- CI, migrations, documentation, and release status match the shipped behavior; remaining account-provider/database provisioning requirements are listed for manual validation.
- A secure feed-fetching/storage design is approved and tested before subscriptions are enabled. One account cannot read/write another account's data or subscription URLs.

## AI execution prompt

Before implementation, review ADR 0003 and this threat model. Build protocol schemas, fixtures, and a deterministic test harness first. Implement authenticated service boundaries and D1 migrations next; write negative authorization and interrupted/idempotent retry tests before client integration. Keep local writes authoritative and make sync asynchronous. Never treat a client timestamp or client-supplied owner ID as authority.
