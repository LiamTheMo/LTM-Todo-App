# v3.00 Accounts, Sync & Ecosystem — Delivery Status

## Goal and release gates

Deliver an offline-first account and synchronization system across the supported responsive web app on desktop, iPhone, and iPad. Add protected attachments, portable backups, and optional read-only HTTPS iCalendar (ICS) subscriptions without changing local-first task behavior or the 31-calendar-day Dashboard history policy. Native Apple app source is not maintained; mobile support is through the installed web app.

Phase checkpoints are cumulative: `v2.01` (Phase 10), `v2.02` (Phase 11), and `v2.03` (Phase 12), followed by the integrated `v3.00` release and Cloudflare production deployment from `main`.

| Checkpoint | Phase | Implementation | Promotion / validation |
| --- | --- | --- | --- |
| `v2.01` | Phase 10: backend, authentication, and sync protocol | Complete Phase 10–12 implementation is present in this cumulative tree | PR #144 merged; `web` and `docs` CI passed on commit `2d5a926` |
| `v2.02` | Phase 11: multi-device sync and ICS | Inherits the complete implementation from `v2.01`; phase code landed together in PR #144 | Checkpoint created from validated `v2.01`; Phase 11 checkpoint promotion is in progress |
| `v2.03` | Phase 12: portability, attachments, lifecycle, and release hardening | Implemented and tested in the inherited cumulative tree | Checkpoint not yet created |
| `v3.00` | Integrated release | Code is present in the cumulative tree | Release branch/PR to `main` not yet created; no production deployment |

## Current implementation state

PR #144 (`feat/v2.01-phase10-cloudflare-d1`) merged the complete Phase 10–12 implementation into `v2.01` as commit `2d5a9265f78966b20dfbe4f6bdd5ca4c683854e4`. The branch's GitHub Actions run completed successfully: both required `web` and `docs` checks passed. The original implementation was co-located rather than delivered as three independent phase PRs. The later `v2.02` and `v2.03` branches are being maintained as cumulative checkpoints, and this history is not represented as separate phase-specific code delivery.

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

Local validation on the implementation tree passed: 151 tests, TypeScript typecheck, ESLint, Vinext production build, and dependency audit. The production dependency audit is clean; one documented unpatched development-only `braces` advisory remains allowed. On the merged `v2.01` commit, GitHub Actions `web` and `docs` checks both passed.

## Remaining release gates

**Requires Cloudflare/user-side configuration and live validation:** production D1, R2, Durable Object and rate-limit bindings; OIDC provider settings and secrets; production migrations/connectivity; TLS/DNS pinning in the live Worker; cross-device and supported-device journeys; backup restore, account deletion, retention, attachment recovery, and orphan-cleanup drills.

**Still in progress:** merge and validate the `v2.02` and `v2.03` cumulative checkpoints; create the `v3.00` release branch and PR to `main`; verify Cloudflare Workers Builds production deployment. No production deployment has been verified yet.
