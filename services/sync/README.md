# Sync service setup

v3 sync runs entirely on Cloudflare: the Worker serves authentication and API routes, a dedicated D1 database stores sync state and attachment metadata, a per-account Durable Object serializes sync operations, and a private R2 bucket stores attachment bytes. The separate notifications D1 database remains unchanged. Keep provider values and secrets out of source control.

## Worker configuration

Create these Cloudflare resources with the exact names used by `apps/web/wrangler.jsonc`:

- D1 database `ltm-todo-notifications` for web push registrations and scheduled reminders.
- D1 database `ltm-todo-sync` for accounts, entities, revisions, devices, journals, idempotency, throttling, attachment metadata, and cleanup jobs.
- R2 bucket `ltm-todo-attachments`, kept private.
- SQLite-backed Durable Object migration/binding for `AccountSyncCoordinator`.
- Unique Rate Limiting namespace IDs for `SYNC_EDGE_LIMITER` and `AUTH_EDGE_LIMITER`.

The `main`-only deployment script requires build variables `D1_DATABASE_ID` and `SYNC_D1_DATABASE_ID`, plus the runtime values listed below as build secrets, including `VAPID_PRIVATE_KEY`, `AUTH_SESSION_SECRET`, `SYNC_CURSOR_SECRET`, and `ICS_FEED_ENCRYPTION_KEY`. It injects D1 IDs and Worker secrets into temporary configs, applies both remote D1 migration sets, deploys the Worker, and restores the built config. Do not run production deployment from a feature or version branch.

Apply migrations locally with `npm run migrate:local` from `apps/web`. This command uses Wrangler's local D1 emulator. The migrations live in `apps/web/migrations` and `apps/web/sync-migrations`.

## Identity and Worker secrets

Select an OIDC provider that supports Authorization Code with PKCE and configure the web client callback at `/api/v1/auth/callback`. Add the corresponding Worker settings/secrets:

- `OIDC_ISSUER` — exact HTTPS issuer claim.
- `OIDC_AUDIENCE` — API audience.
- `OIDC_JWKS_URI` — HTTPS JWKS endpoint.
- `OIDC_CLIENT_ID` — public web client ID.
- `OIDC_CLIENT_SECRET` — only when required by the provider; secret.
- `OIDC_REDIRECT_URI` — exact HTTPS callback URI.
- `AUTH_SESSION_SECRET` — base64url encoding of 32 random bytes.
- `SYNC_CURSOR_SECRET` — base64url encoding of 32 random bytes.
- `ICS_FEED_ENCRYPTION_KEY` — a distinct base64url encoding of 32 random bytes used to encrypt bearer calendar-feed URLs at rest. Rotating it without a re-encryption plan makes existing URLs unavailable.

The app uses application OIDC sessions. Cloudflare Access can be added as an outer allowlist for a personal deployment, but should not replace OIDC unless its identity headers/session behavior are explicitly integrated and tested.

## Routes and behavior

Auth routes: `GET /api/v1/auth/login?returnTo=/path`, `GET /api/v1/auth/callback`, `GET /api/v1/auth/session`, and same-origin `POST /api/v1/auth/logout`. Session registry endpoints allow account owners to list/revoke application sessions; this does not revoke sessions at the OIDC provider.

Sync routes: `POST /api/v1/sync/push` and `GET /api/v1/sync/changes`. The authenticated Worker hashes the verified issuer/subject pair to select an account Durable Object. The object serializes account operations; D1 batch writes make each push atomic. D1 independently enforces 120 authenticated sync operations per account per minute, in addition to the Cloudflare edge limiter.

Attachment routes: `POST` and `GET /api/v1/attachments`, plus `GET` and `DELETE /api/v1/attachments/{id}`. Uploads are raw bytes with `Content-Type`, `X-LTM-Task-Id`, URL-encoded `X-LTM-File-Name`, and a UUID `Idempotency-Key`. JPEG, PNG, WebP, PDF, and UTF-8 text are accepted up to 10 MiB. The service checks account ownership and task existence, generates object keys server-side, and never returns keys. Failed R2 deletion is recorded in the D1 outbox and retried by the Worker cron.

Lifecycle routes support same-origin account deletion, device listing/retirement, and attachment cleanup; sync retention retires inactive devices after 180 days and preserves current-state tombstones while compacting acknowledged journal history. ICS routes store URLs encrypted at rest, expose only bounded cached metadata/events to the owning account, and refresh through the Worker cron using a DNS-validated, pinned-address TLS transport. Feed URLs and event data are never logged or included in task backups.

## Release validation

Production connectivity, OIDC provider compatibility, resource bindings, scheduled cleanup, backup/recovery behavior, and supported-device sync must be smoke-tested after Cloudflare provisioning. The ICS transport is implemented and unit-tested; production feed activation still requires a live DNS/TLS socket smoke test that confirms peer-address pinning and hostname verification. D1 and R2 do not share a transaction, so upload compensation and deletion retries require a production orphan-reconciliation drill.
