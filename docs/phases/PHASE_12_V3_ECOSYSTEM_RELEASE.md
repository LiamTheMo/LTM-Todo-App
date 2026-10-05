# Phase 12 — Backup, Export, Attachments, Sharing & v3 Release Hardening
**Checkpoint:** `v2.03`
**Target release:** `v3.00`

## Objective
Complete the multi-device ecosystem and harden it for sustained personal use.

## Scope
Portable export/backup format; restore/import validation; attachment metadata/storage; quotas based on technical safety rather than arbitrary feature gating; optional project/task sharing and collaboration if enabled; audit/security pass; privacy controls; session/device management; disaster recovery; full regression/performance/accessibility release pass.

## Calendar subscription recovery
Document whether exports include subscription URLs; by default, never include bearer feed URLs in an unencrypted export. Verify users can remove subscriptions, revoke stored credentials, recover after feed failures, and distinguish cached read-only external events from their own editable calendars.

Review privacy, account/device recovery, account deletion, retention, data export, and the server-side fetch/cache lifecycle for read-only ICS subscriptions. Feed removal and account deletion must remove cached feed content within a documented bounded period. Export/restore behavior and the app's configured Dashboard history-retention policy must be explicit and tested.

## Data portability
Export should use documented, versioned formats and preserve stable IDs/relationships where safe. Restore is transactional or recoverable. Validate before destructive replacement.

## Attachments
Protect authorization at object access. Handle upload interruption, orphan cleanup, content type/size validation and offline placeholders. Do not embed large binaries in primary sync payloads.

## Collaboration
If implemented, explicitly model membership/roles and server authorization. Do not infer permission from possession of an ID/link. Conflict semantics must be revisited for multi-user edits.

## Release validation
Full desktop/iPhone/iPad responsive-web matrix; offline/online transitions; large dataset; migration from prior versions; restore drill; sync outage; ICS subscription add/refresh/unsubscribe and failure recovery; feed-URL privacy; accessibility; notification lifecycle; security/dependency scanning.

## Acceptance criteria
Users can recover/export their data. No known critical data-loss/security issue. v1/v2 functionality remains intact across synchronized clients. Remaining manual checks are documented and completed before declaring v3.00 production-ready.

## Current implementation status (2026-10-05)

Versioned, bounded JSON backup/restore; account-protected attachments with offline retry and R2 cleanup; app-session revocation; inactive-device expiry; journal/tombstone retention; account deletion; and cleanup/reconciliation workers are implemented with automated failure-path coverage and deployed through `v3.00` into `main`. Backups exclude attachment bytes and metadata plus ICS URLs/event caches; attachments are downloaded separately, and bearer feed URLs are never exported unencrypted. Sharing/collaboration is explicitly deferred from the initial v3.00 release rather than implemented without a membership/role contract.

Normal production sign-in and cross-device sync were confirmed working by the user on 2026-10-05. The full recovery, deletion, retention, restore, attachment, accessibility, and supported-device drills remain manual acceptance work against the provisioned Cloudflare resources. Code implementation and a successful deployment are therefore distinct from full release acceptance; see `../V3_STATUS.md` for the final audit checklist.

## AI execution prompt
Treat Phase 12 as an ecosystem/reliability audit, not a feature dump. Implement data portability and security-sensitive attachment/sharing behavior with failure tests. Repeat the CI/review loop until actionable issues are exhausted, then produce a release audit classified as Passed, Manual Validation, or Needs Work.
