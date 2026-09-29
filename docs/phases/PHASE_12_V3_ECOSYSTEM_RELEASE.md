# Phase 12 — Backup, Export, Attachments, Sharing & v3 Release Hardening
**Target:** v3.00

## Objective
Complete the multi-device ecosystem and harden it for sustained personal use.

## Scope
Portable export/backup format; restore/import validation; attachment metadata/storage; quotas based on technical safety rather than arbitrary feature gating; optional project/task sharing and collaboration if enabled; audit/security pass; privacy controls; session/device management; disaster recovery; full regression/performance/accessibility release pass.

## Data portability
Export should use documented, versioned formats and preserve stable IDs/relationships where safe. Restore is transactional or recoverable. Validate before destructive replacement.

## Attachments
Protect authorization at object access. Handle upload interruption, orphan cleanup, content type/size validation and offline placeholders. Do not embed large binaries in primary sync payloads.

## Collaboration
If implemented, explicitly model membership/roles and server authorization. Do not infer permission from possession of an ID/link. Conflict semantics must be revisited for multi-user edits.

## Release validation
Full iPhone/iPad/browser matrix; offline/online transitions; large dataset; migration from prior versions; restore drill; sync outage; accessibility; notification lifecycle; security/dependency scanning.

## Acceptance criteria
Users can recover/export their data. No known critical data-loss/security issue. v1/v2 functionality remains intact across synchronized clients. Remaining manual checks are documented and completed before declaring v3.00 production-ready.

## AI execution prompt
Treat Phase 12 as an ecosystem/reliability audit, not a feature dump. Implement data portability and security-sensitive attachment/sharing behavior with failure tests. Repeat the CI/review loop until actionable issues are exhausted, then produce a release audit classified as Passed, Manual Validation, or Needs Work.
