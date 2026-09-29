# Phase 6 — Search, Filters, History & v1 Hardening
**Target:** v1.00

## Objective
Finish v1 as a coherent daily-driver rather than a collection of features.

## Scope
Global search; filter predicates for status/project/tag/priority/date; saved query groundwork; completion history; bulk completion/organization where safe; settings; data integrity checks; performance profiling; accessibility audit; crash/error handling; onboarding/empty states; local backup/export groundwork if low-risk.

## Search
Search title and notes initially; tags/projects participate through structured filters. Results must explain active filters. Search must not silently hide overdue items because of stale indexes.

## Hardening
Profile startup, Dashboard scrolling and large lists. Audit migrations, destructive actions, notification reconciliation, date semantics, accessibility, privacy and dependency security. Add regression tests for every defect discovered.

## Acceptance criteria
All v1 phase criteria remain green. Search is fast on realistic local data. No known data-loss defect. Accessibility audit has no unresolved critical blockers. CI is required and stable. Manual device checklist is documented.

## Release gate
v1.00 is not declared complete solely because automated tests pass. iPhone/iPad manual validation is required for notifications, gestures, keyboard/pointer, layout and lifecycle behavior.

## AI execution prompt
Perform a repository-wide v1 audit, then implement only missing Phase 6 scope and fixes discovered by the audit. Repeat Audit -> Fix -> Validate -> Review until no actionable automated issues remain. Produce a final three-category phase audit and do not hide manual validation requirements.
