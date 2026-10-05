# v3.00 Accounts, Sync & Ecosystem — Delivery Status

## Goal and release gates

Deliver an offline-first account and synchronization system across the supported responsive web app on desktop, iPhone, and iPad. Add protected attachments, portable backups, and optional read-only HTTPS iCalendar (ICS) subscriptions without changing local-first task behavior or the 31-calendar-day Dashboard history policy. Native Apple app source is not maintained; mobile support is through the installed web app.

Phase checkpoints are cumulative: `v2.01` (Phase 10), `v2.02` (Phase 11), and `v2.03` (Phase 12), followed by the integrated `v3.00` release and Cloudflare production deployment from `main`.

| Checkpoint | Phase | Implementation | Promotion / validation |
| --- | --- | --- | --- |
| `v2.01` | Phase 10: backend, authentication, and sync protocol | Complete Phase 10–12 implementation is present in this cumulative tree | PR #144 merged; `web` and `docs` CI passed |
| `v2.02` | Phase 11: multi-device sync and ICS | Inherits the complete implementation from `v2.01`; phase code landed together in PR #144 | PR #145 merged; `web` and `docs` CI passed |
| `v2.03` | Phase 12: portability, attachments, lifecycle, and release hardening | Inherits the complete implementation from `v2.02` | PR #146 merged; `web` and `docs` CI passed |
| `v3.00` | Integrated release | Inherits the validated cumulative implementation | Release branch created from `v2.03`; branch CI passed; promoted to `main`; production sign-in confirmed, sync recovery validation remains |

## Current implementation state

PR #144 (`feat/v2.01-phase10-cloudflare-d1`) merged the complete Phase 10–12 implementation into `v2.01`. PRs #145 and #146 promoted the cumulative Phase 11 and Phase 12 checkpoints into `v2.02` and `v2.03`. Each checkpoint's GitHub Actions `web` and `docs` checks passed. Branch `v3.00` was created from the validated `v2.03` commit, and its CI passed. The original implementation was co-located rather than delivered as three independent phase PRs. The version branches are cumulative snapshots; the history is not represented as separate phase-specific code delivery. The integrated release and subsequent sign-in fixes were promoted to `main`, most recently through PR #168. Production sign-in is confirmed by the user. Cross-device sync exposed additional initial-upload and paged-download defects addressed below.

### Phase 10 — Backend, Authentication & Sync Protocol (`v2.01`)

- [x] Cloudflare backend/auth decision and threat model are documented in ADR 0003.
- [x] Versioned entity schema, authorization boundary, protocol JSON Schema, fixtures, API parser, and account-scoped opaque cursors are implemented and tested.
- [x] D1 sync schema and transactional adapter, per-account Durable Object coordination, OIDC verification, Authorization Code + PKCE session flow, CSRF/origin checks, bounded requests, and rate limits are implemented.
- [x] Local migrations and SQLite integration tests cover atomicity, account isolation, conflicts, and retry behavior.
- [ ] Production OIDC compatibility, D1/R2/Durable Object bindings, edge-limit namespaces, secrets, and migrations require provisioned Cloudflare resources and live smoke tests.

### Phase 11 — Multi-Device Sync & Web Client (`v2.02`)

- [x] IndexedDB journal and offline-first sync, account binding, retry/backoff, explicit conflict decisions, cursor snapshots, device registration/retirement, and session controls are implemented with tests.
- [x] Read-only ICS subscriptions support add, refresh, visibility, recoloring, unsubscribe, conditional requests, bounded caching, and offline display. Feed URLs are encrypted at rest and excluded from browser logs and portable backups.
- [x] The Worker fetch path validates every redirect and DNS answer, connects to a literal validated address with TLS hostname verification, bounds time/response size, and parses stable recurrence identities, including moved and cancelled exceptions.
- [ ] Verify actual Worker DNS/TLS socket behavior and OIDC/ICS integration against provisioned Cloudflare resources before enabling production feed refresh.
- [ ] Desktop, iPhone/iPad installed-web-app, multi-device conflict, and offline/online journeys require supported-device validation.

### Phase 12 — Portability, Attachments & Lifecycle (`v2.03`)

- [x] Versioned local JSON backup/restore is size-bounded and fully validated before replacement. It excludes attachment bytes/metadata and ICS URLs/event caches; attachments are downloaded separately, and feed URLs are never exported unencrypted.
- [x] Private account-scoped attachment APIs use D1 metadata and R2 bytes, enforce task ownership and content/size limits, support durable offline upload retries, and enqueue failed object deletions for cleanup.
- [x] Account-scoped session listing/revocation, device inactivity retirement, cursor-aware journal/tombstone retention, account deletion, paged R2 cleanup, and orphan reconciliation have failure-path tests. App session revocation does not revoke a user's session at the identity provider.
- [x] Sharing/collaboration is explicitly deferred from the initial v3.00 release; object identifiers do not imply a membership/role model.
- [ ] Run production backup-restore, account-deletion, R2 reconciliation, and retention drills after Cloudflare resource provisioning.
- [ ] Complete accessibility, performance, migration, supported-device, and production security/recovery reviews.

## Automated verification

Local validation on the implementation tree passed: 151 tests, TypeScript typecheck, ESLint, Vinext production build, and dependency audit. The production dependency audit is clean; one documented unpatched development-only `braces` advisory remains allowed. GitHub Actions `web` and `docs` checks passed on the `v2.01`, `v2.02`, `v2.03`, and `v3.00` branch commits.

## Remaining release gates

**Requires Cloudflare configuration and live validation:** production D1, R2, Durable Object and rate-limit bindings; two D1 IDs and production migrations; OIDC provider settings and secrets; stable sync/session/feed-encryption and VAPID secrets; TLS/DNS pinning in the live Worker; cross-device and supported-device journeys; backup restore, account deletion, retention, attachment recovery, and orphan-cleanup drills. Cloudflare Workers Builds must be connected to this repository with `main` as production branch, `apps/web` as the root, build command `npm run build:vinext`, deploy command `npm run deploy:worker`, and preview builds disabled.

**Requires Manual Validation:** after the sync recovery changes reach `main`, confirm that an existing device uploads its tasks and calendars, a fresh device loads them, and edits sync in both directions. Check the Settings sync detail if any operation remains paused.


## Account sync recovery — 2026-10-05

### Completed / Passed

- Existing local records and the default calendar are queued for initial upload after the account snapshot. Already acknowledged records, existing queued edits, conflicts, and local tombstones are preserved.
- Uploads and snapshot pages share dependency ordering so calendars/projects/tasks arrive before their linked records. Old snapshot continuations restart under the new ordering; incremental cursors remain compatible.
- Paused sync reports the failing operation and an allowlisted error category. Worker logs classify database/schema/quota failures without recording SQL, tokens, account identifiers, or user content.
- An integration test covers an older local profile uploading 20 records, a second IndexedDB profile loading multiple snapshot pages, and an edit returning to the first device without duplicate uploads.
- Native browser fetch and timeout functions retain their global receiver when used by the sync client. A regression test covers receiver-sensitive browser APIs; otherwise session checks can fail before any network request is sent while the separate sign-in indicator still succeeds.

### Requires Manual Validation

- On the device holding existing data, reload the updated app and use Settings → Sync now. Then open the same account on another device and verify tasks, calendars, events, and edits in both directions.
- Authenticated production sync needs a live account session; the automated integration test uses an injected test principal. If production still pauses, Settings now identifies the exact operation, HTTP status, and fixed error category for further diagnosis.

### Incomplete / Needs Work

- No additional known implementation blocker remains in the initial-upload and paged-download flows. Production resource limits or configuration failures, if reported by the new diagnostics, still require investigation before cross-device sync can be marked manually passed.
