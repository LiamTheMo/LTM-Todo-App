# v1.00 Release Readiness

This document tracks the v1 scope in Phases 1–6. The permanent `v0.xx` branches are development checkpoints; `v1.00` is created from the final validated checkpoint after this release gate passes.

## Completed / Passed

- Phases 1–6 implementation is present across the Apple and web clients: local-first task capture and editing, Dashboard timeline, projects/sections/subtasks/tags, recurrence and reminders, search/filtering, saved views, bulk completion, local backup, and storage integrity checks.
- Dashboard date semantics and retention, task relationships, recurrence, notifications, migrations, reordering, search, and performance have automated regression coverage.
- The latest `v0.08` commit, `bd5cccdcb1c47111d988aba3d4b8621c66f38707`, passed all four CI jobs in run `36899185542`: `swift-core`, `apple`, `web`, and `docs`.
- The current `main` snapshot was independently audited: 43 web tests passed; typecheck, lint, Vinext production build, and high-severity dependency audit passed. The audit environment does not include Xcode, so Apple build/test evidence is from CI.
- GitHub's active `main` ruleset now requires all four CI checks: `swift-core`, `apple`, `web`, and `docs`, in addition to requiring a pull request.
- The user verified production Web Push configuration and the real-device notification path, including permissions, closed/background delivery, schedule changes/cancellation, reconnection, and permission revocation.
- The user verified the manual iPhone/iPad checklist, including navigation, VoiceOver, Dynamic Type, keyboard/pointer and gesture behavior, date/time transitions, and lifecycle behavior.
- The custom navigation artwork added in `v0.08` passed Apple simulator navigation/accessibility smoke tests.

## Remaining Implementation

- No in-scope Phase 1–6 implementation gaps were identified in the v1.00 readiness audit.
- The permanent `v1.00` branch was created on 2026-10-01 from the validated `v0.08` commit `e01d8c34039e3a1aa7f039c0131c637bd0aeb802`.
- Promoting `v1.00` to `main` is a separate release action and must use a version-to-main pull request. Cloudflare Workers Builds deploys production from `main`.

## Scope boundaries

- Cross-device accounts and synchronization remain v3 scope. Task data is local to each client/device in v1.
- First-party calendar events, time blocking, and advanced planning remain v2 scope.

## v1.00 release gate

1. Audit Phases 1–6 and resolve any actionable in-scope implementation gaps. **Passed** in the readiness audit.
2. Merge this status update into the validated `v0.08` checkpoint and wait for all four required CI jobs to pass. **Passed** (PR #73; run `36914999243`).
3. Verify production Web Push setup and delivery on real devices. **User verified.**
4. Complete the Phase 6 iPhone/iPad manual checklist. **User verified.**
5. Require `swift-core`, `apple`, `web`, and `docs` checks in the `main` ruleset. **Verified.**
6. Create the permanent `v1.00` branch from the final validated `v0.08` checkpoint. **Passed** on 2026-10-01 from commit `e01d8c34039e3a1aa7f039c0131c637bd0aeb802`.
7. When production promotion is requested, merge `v1.00` into `main` via a pull request and verify deployment.

## Validation record (2026-10-01)

- User-confirmed: production push setup/delivery and the iPhone/iPad manual checklist.
- GitHub-confirmed: all four `v0.08` CI jobs passed on commit `bd5cccdcb1c47111d988aba3d4b8621c66f38707`; the `main` ruleset requires those checks.
- Codex audit: current `main` web tests, typecheck, lint, Vinext build, and `npm audit --audit-level=high` passed. The Vinext build reports the existing unresolved favicon reference and ineffective dynamic-import warnings; the build succeeds.
