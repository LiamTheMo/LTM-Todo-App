# ADR 0003: v3 Sync Backend and Authentication Boundary

## Status

Accepted for v3 implementation. Cloudflare D1 and R2 are the persistence services. A compatible managed OIDC provider and Cloudflare production resources remain deployment choices.

## Context

The app is deployed as a Cloudflare Worker and keeps the browser experience local-first in IndexedDB. v3 requires authenticated multi-device sync, ownership checks, incremental change delivery, data portability, and protected attachments. The owner has chosen to keep the app's infrastructure within Cloudflare.

## Decision

- Keep the Cloudflare Worker as the API runtime. Store sync accounts, entities, revisions, tombstones, idempotency results, devices, change journals, rate limits, and attachment metadata in a dedicated D1 database. Keep the existing notifications D1 database separate.
- Use one SQLite-backed Durable Object per authenticated `(issuer, subject)` pair to serialize sync operations. Hash that pair before deriving the object name. Each push uses a D1 batch for atomic persistence; the object enforces per-account operation ordering across Worker isolates.
- Store attachment bytes in a private R2 bucket. The Worker creates account-scoped object keys and authorizes every list, upload, download, and delete through D1 metadata. Failed R2 deletes are retained in a D1 outbox and retried by the Worker cron.
- Keep sync and authentication provider-neutral. Web clients use Authorization Code with PKCE; the Worker verifies issuer, audience, expiry, not-before, signature, and allowed algorithms against JWKS. The account identity is derived only from the verified `(issuer, subject)` pair.
- Use opaque account-scoped server cursors and bounded versioned requests/responses. Keep local writes authoritative and propagate them asynchronously.
- Keep read-only calendar subscriptions separate from editable calendar data. The local implementation uses DNS validation, literal-address connection pinning, per-redirect validation, and TLS hostname verification; production activation remains gated on a live Worker smoke test.

## Alternatives considered

- **PostgreSQL through Hyperdrive:** rejected for this deployment because it requires an external database service, conflicting with the Cloudflare-only infrastructure choice.
- **D1 without coordination:** rejected because concurrent pushes from multiple Worker isolates could both validate against the same base revision. A per-account Durable Object provides a single serialized coordinator while D1 batches provide durable atomic writes.
- **Cloudflare Access as the only identity mechanism:** not selected as a default. Access allowlists can restrict a personal deployment, but the app's OIDC boundary is intended to support a separately managed application identity and should not assume all users belong to the Cloudflare account.
- **Store attachment bytes in D1:** rejected because R2 is designed for object storage and avoids putting binary data in the relational sync database.

## Consequences

- Cloudflare setup requires two D1 databases (`ltm-todo-notifications`, `ltm-todo-sync`), the SQLite-backed `AccountSyncCoordinator` Durable Object, an R2 bucket (`ltm-todo-attachments`), unique rate-limit namespace IDs, OIDC configuration, and Worker secrets.
- Wrangler applies D1 migrations from `apps/web/migrations` and `apps/web/sync-migrations`. Production migration and deployment steps are guarded by the `main`-only deployment script.
- D1 and R2 cannot share one transaction. Upload compensation and the deletion outbox reduce inconsistency, but production recovery drills and orphan reconciliation remain release checks.
- Account-provider compatibility, credential rotation, Cloudflare resource IDs, production connectivity, and supported-device behavior require manual validation after provisioning.
