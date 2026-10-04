# v3.00 Accounts, Sync & Ecosystem — Delivery Status

## Goal and release gates

Deliver an offline-first account and synchronization system across the supported responsive web app on desktop, iPhone, and iPad. Add protected attachments, portable backups, and optional read-only HTTPS iCalendar (ICS) subscriptions without changing local-first task behavior or the 31-calendar-day Dashboard history policy. Native Apple app source is not maintained; mobile support is through the installed web app.

Phase work is delivered as cumulative checkpoints: `v2.01` (Phase 10), `v2.02` (Phase 11), and `v2.03` (Phase 12), followed by the integrated `v3.00` release PR to `main`. Production deployment is main-only through Cloudflare Workers Builds. No temporary feature branch is a release.

| Checkpoint | Phase | Code status in current local tree | Promotion status |
| --- | --- | --- | --- |
| `v2.01` | Backend, authentication, and sync protocol | Implemented; local checks pass | Not yet merged to the checkpoint |
| `v2.02` | Multi-device web client and read-only ICS subscriptions | Implemented; local checks pass | Not yet merged to the checkpoint |
| `v2.03` | Backup/restore, attachments, lifecycle and release hardening | Implemented; local checks pass | Not yet merged to the checkpoint |
| `v3.00` | Integrated v3 release | Code is present locally | Not yet created, reviewed, or promoted |

## Current implementation state

The complete Phase 10–12 implementation is co-located on `feat/v2.01-phase10-cloudflare-d1` and has been pushed as commit `bc73fec`. A PR to the new `v2.01` checkpoint is the next promotion step; remote CI and merge have not run, and there is no production deployment. The code is integrated on one implementation branch rather than separated into distinct Phase 10/11/12 PRs, so the later phase checkpoints still need to be created after `v2.01` validation.

### Phase 10 — Backend, Authentication & Sync Protocol (`v2.01`)

- [x] Threat model and Cloudflare backend/auth decision are documented in ADR 0003.
- [x] Versioned entity schema, authorization boundary, protocol JSON Schema, valid/invalid fixtures, API parser, and account-scoped opaque cursors are implemented and tested.
- [x] D1 sync schema and transactional adapter, per-account Durable Object coordination, OIDC verification, Authorization Code + PKCE session flow, CSRF/origin checks, bounded requests, and rate limits are implemented.
- [x] Local migrations and SQLite integration tests cover atomicity, account isolation, conflicts, and retry behavior.
- [ ] Production OIDC compatibility, D1/R2/Durable Object bindings, edge-limit namespaces, secrets, and migrations still require provisioned Cloudflare resources and live smoke tests.

### Phase 11 — Multi-Device Sync & Web Client (`v2.02`)

- [x] IndexedDB journal and offline-first sync, account binding, retry/backoff, explicit conflict decisions, cursor snapshots, device registration/retirement, and session controls are implemented with tests.
- [x] Read-only ICS subscriptions support add, refresh, visibility, recoloring, unsubscribe, conditional requests, bounded caching, and offline display. Feed URLs are encrypted at rest and excluded from browser logs and portable backups.
- [x] The Worker fetch path validates every redirect and DNS answer, connects to a literal validated address with TLS hostname verification, bounds time/response size, and parses stable recurrence identities, including moved and cancelled exceptions.
- [ ] Verify actual Worker DNS/TLS socket behavior and OIDC/ICS integration against provisioned Cloudflare resources before enabling production feed refresh.
- [ ] Desktop, iPhone/iPad installed-web-app, multi-device conflict, and offline/online journeys still need manual supported-device validation.

### Phase 12 — Portability, Attachments & Lifecycle (`v2.03`)

- [x] Versioned local JSON backup/restore is size-bounded and fully validated before replacement. It deliberately excludes attachment bytes/metadata and ICS URLs/event caches; attachments are downloaded separately, and feed URLs are never exported unencrypted.
- [x] Private account-scoped attachment APIs use D1 metadata and R2 bytes, enforce task ownership and content/size limits, support durable offline upload retries, and enqueue failed object deletions for cleanup.
- [x] Account-scoped session listing/revocation, device inactivity retirement, cursor-aware journal/tombstone retention, account deletion, paged R2 cleanup, and orphan reconciliation are implemented with failure-path tests. App session revocation does not revoke the user's session at the identity provider.
- [x] Sharing/collaboration is explicitly deferred from the initial v3.00 release; it requires a separately designed membership/role model and is not implied by object identifiers.
- [ ] Run production backup-restore, account-deletion, R2 reconciliation, and retention drills after resource provisioning.
- [ ] Complete accessibility, performance, migration, supported-device, and production security/recovery reviews.

## Local verification

The final local verification passed: 151 tests, TypeScript typecheck, ESLint, Vinext production build, and the dependency audit. The dependency audit allows only its documented, unpatched development-only `braces` advisory; the production dependency audit is clean. `git diff --check` and the local `v2.01` branch-flow validation also pass.

## Release audit

**Completed locally:** Phase 10–12 code and automated behavior tests.

**Requires manual validation:** Cloudflare production bindings/secrets/provider configuration; production migrations/connectivity; TLS/DNS pinning in the live Worker; multi-device and supported-device UI journeys; backup restore, deletion, retention, attachment-recovery and orphan-cleanup drills.

**Incomplete release operations:** Open and merge the implementation PR to `v2.01`; wait for version-branch CI; create and validate `v2.02` and `v2.03` checkpoints; create and merge the `v3.00`-to-`main` PR; verify Cloudflare's main-branch deployment. Until those complete, deployed `main` remains the previous v2 behavior.
