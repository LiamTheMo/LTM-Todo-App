# v3.00 Accounts, Sync & Ecosystem — Delivery Status

## Goal and release gates

Deliver an offline-first account and synchronization system across the supported responsive web app on desktop, iPhone, and iPad. Add protected attachments, portable backups, and optional read-only HTTPS iCalendar (ICS) subscriptions without changing local-first task behavior or the 31-calendar-day Dashboard history policy. Native Apple app source is not maintained; mobile support is through the installed web app.

Phase checkpoints are cumulative: `v2.01` (Phase 10), `v2.02` (Phase 11), and `v2.03` (Phase 12), followed by the integrated `v3.00` release and Cloudflare production deployment from `main`.

| Checkpoint | Phase | Implementation | Promotion / validation |
| --- | --- | --- | --- |
| `v2.01` | Phase 10: backend, authentication, and sync protocol | Complete Phase 10–12 implementation is present in this cumulative tree | PR #144 merged; `web` and `docs` CI passed |
| `v2.02` | Phase 11: multi-device sync and ICS | Inherits the complete implementation from `v2.01`; phase code landed together in PR #144 | PR #145 merged; `web` and `docs` CI passed |
| `v2.03` | Phase 12: portability, attachments, lifecycle, and release hardening | Inherits the complete implementation from `v2.02` | PR #146 merged; `web` and `docs` CI passed |
| `v3.00` | Integrated release | Inherits the validated cumulative implementation | Version CI passed; promoted to `main`; Cloudflare deployment verified; user confirmed production sign-in and normal cross-device sync |

## Current implementation state

PR #144 (`feat/v2.01-phase10-cloudflare-d1`) merged the complete Phase 10–12 implementation into `v2.01`. PRs #145 and #146 promoted the cumulative Phase 11 and Phase 12 checkpoints into `v2.02` and `v2.03`. Each checkpoint's GitHub Actions `web` and `docs` checks passed. Branch `v3.00` was created from the validated `v2.03` commit, and its CI passed. The original implementation was co-located rather than delivered as three independent phase PRs. The version branches are cumulative snapshots; the history is not represented as separate phase-specific code delivery. Sign-in fixes were followed by initial-upload/snapshot recovery fixes in PRs #169–170 and browser API receiver fixes in PRs #171–172. Both fixes passed version CI and were deployed through `main`. The Cloudflare production build for main commit `d7fdb37746b8c5b4e797999ce92dcf6cec77d3fa` succeeded, and the deployed client was checked for the corrected fetch/timer bindings. On 2026-10-05 the user confirmed that sign-in and cross-device sync are working. Advanced recovery and lifecycle checks below remain separate from that confirmation.

### Phase 10 — Backend, Authentication & Sync Protocol (`v2.01`)

- [x] Cloudflare backend/auth decision and threat model are documented in ADR 0003.
- [x] Versioned entity schema, authorization boundary, protocol JSON Schema, fixtures, API parser, and account-scoped opaque cursors are implemented and tested.
- [x] D1 sync schema and transactional adapter, per-account Durable Object coordination, OIDC verification, Authorization Code + PKCE session flow, CSRF/origin checks, bounded requests, and rate limits are implemented.
- [x] Local migrations and SQLite integration tests cover atomicity, account isolation, conflicts, and retry behavior.
- [x] Production deployment provisions the configured bindings/secrets and applies both D1 migration sets. OIDC sign-in and the D1/Durable Object sync path are confirmed working in production.
- [ ] R2 attachment behavior and advanced operational recovery still require live functional drills.

### Phase 11 — Multi-Device Sync & Web Client (`v2.02`)

- [x] IndexedDB journal and offline-first sync, account binding, retry/backoff, explicit conflict decisions, cursor snapshots, device registration/retirement, and session controls are implemented with tests.
- [x] Read-only ICS subscriptions support add, refresh, visibility, recoloring, unsubscribe, conditional requests, bounded caching, and offline display. Feed URLs are encrypted at rest and excluded from browser logs and portable backups.
- [x] The Worker fetch path validates every redirect and DNS answer, connects to a literal validated address with TLS hostname verification, bounds time/response size, and parses stable recurrence identities, including moved and cancelled exceptions.
- [ ] Verify actual Worker DNS/TLS socket behavior and OIDC/ICS integration against provisioned Cloudflare resources before enabling production feed refresh.
- [x] Normal signed-in cross-device sync is confirmed working by the user after the recovery fixes were deployed.
- [ ] The full desktop/iPhone/iPad installed-web-app matrix, concurrent-edit conflict resolution, and offline/online recovery journeys require separate supported-device validation.

### Phase 12 — Portability, Attachments & Lifecycle (`v2.03`)

- [x] Versioned local JSON backup/restore is size-bounded and fully validated before replacement. It excludes attachment bytes/metadata and ICS URLs/event caches; attachments are downloaded separately, and feed URLs are never exported unencrypted.
- [x] Private account-scoped attachment APIs use D1 metadata and R2 bytes, enforce task ownership and content/size limits, support durable offline upload retries, and enqueue failed object deletions for cleanup.
- [x] Account-scoped session listing/revocation, device inactivity retirement, cursor-aware journal/tombstone retention, account deletion, paged R2 cleanup, and orphan reconciliation have failure-path tests. App session revocation does not revoke a user's session at the identity provider.
- [x] Sharing/collaboration is explicitly deferred from the initial v3.00 release; object identifiers do not imply a membership/role model.
- [ ] Run production backup-restore, account-deletion, R2 reconciliation, and retention drills using disposable test data/accounts.
- [ ] Complete accessibility, performance, migration, supported-device, and production security/recovery reviews.

## Automated verification

Final local validation passed: 162 tests, TypeScript typecheck, ESLint, Vinext production build, and dependency audit. The production dependency audit is clean; one documented unpatched development-only `braces` advisory remains allowed by a lockfile-checked policy. GitHub Actions `web` and `docs` checks passed on the `v2.01`, `v2.02`, `v2.03`, and latest sync-fix `v3.00` commits. Cloudflare production deployment from `main` succeeded. No actionable review findings were present on the latest sync deployment PR.

## Remaining release gates

**Completed / Passed:** implementation and automated regression checks; production sign-in and normal account sync; initial local-data upload, dependency-ordered snapshots and browser API bindings; authenticated ownership and CSRF controls covered by negative tests; main-only deployment enforced by the deploy script and verified on Cloudflare. Public session requests return `authenticated: false` without credentials and use `Cache-Control: no-store`.

**Requires Manual Validation:**

- Offline edits followed by reconnect, and two devices editing the same record with both conflict-resolution choices.
- ICS add/refresh/cancellation/unsubscribe with a real HTTPS feed; prove DNS/address pinning and certificate verification in the deployed Worker, including safe failures.
- Attachment upload/download/delete across devices, interrupted/offline uploads, and R2 orphan cleanup.
- Export/restore on disposable data; verify excluded attachments and feed URLs remain excluded.
- Session/device revocation and account deletion on a disposable account; retention and cleanup drills.
- Full desktop/iPhone/iPad layout, keyboard/screen-reader, notifications, and large-dataset performance checks.

**Incomplete / Needs Work:** no confirmed implementation defect or failing automated gate was found in this final audit. The production dependency audit passed; the existing development-only advisory exception remains documented. Sharing/collaboration is intentionally deferred. The manual checks above remain release acceptance work, so full advanced recovery/security acceptance is not claimed.


## Account sync recovery — 2026-10-05

### Completed / Passed

- Existing local records and the default calendar are queued for initial upload after the account snapshot. Already acknowledged records, existing queued edits, conflicts, and local tombstones are preserved.
- Uploads and snapshot pages share dependency ordering so calendars/projects/tasks arrive before their linked records. Old snapshot continuations restart under the new ordering; incremental cursors remain compatible.
- Paused sync reports the failing operation and an allowlisted error category. Worker logs classify database/schema/quota failures without recording SQL, tokens, account identifiers, or user content.
- An integration test covers an older local profile uploading 20 records, a second IndexedDB profile loading multiple snapshot pages, and an edit returning to the first device without duplicate uploads.
- Native browser fetch and timeout functions retain their global receiver when used by the sync client. A regression test covers receiver-sensitive browser APIs; otherwise session checks can fail before any network request is sent while the separate sign-in indicator still succeeds.
- Both recovery changes were promoted through `v3.00` into `main`, deployed successfully, and normal account sync was confirmed working by the user on 2026-10-05.

### Requires Manual Validation

- Concurrent-edit conflict handling, offline reconnection, and retired-device recovery remain separate manual scenarios. If any operation pauses, Settings identifies its operation, HTTP status, and fixed error category.

### Incomplete / Needs Work

- No known implementation blocker remains in the normal initial-upload and paged-download flows. Investigate new diagnostic failures if production resource limits or configuration changes later affect sync.
