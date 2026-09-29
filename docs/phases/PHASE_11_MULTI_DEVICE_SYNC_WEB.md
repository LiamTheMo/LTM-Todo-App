# Phase 11 — Multi-Device Sync, Conflict Resolution & Web Production Client
**Target:** v3.00

## Objective
Make iPhone, iPad and web converge reliably while each remains usable offline.

## Scope
Apple sync engine; web IndexedDB/local journal; background/foreground synchronization; conflict detection/resolution; retry/backoff; sync status diagnostics; production web parity for v1/v2 core flows; session management; schema migration compatibility.

## Conflict policy
Define per-entity/field policy deliberately. Do not use blanket last-write-wins for destructive or structurally conflicting changes without analysis. Preserve user work where possible and expose actionable conflicts only when automatic resolution would be unsafe.

## Failure cases
Two devices edit same task; offline completion vs remote delete; project move vs archive; recurrence edits; reordered lists; stale client version; server outage; token expiration; partial batch upload.

## Tests
Multi-client simulation with deterministic journals; convergence/property tests; retry/idempotency; conflict fixtures; offline web reload; browser storage migration; auth expiration.

## Acceptance criteria
Two or more clients eventually converge under supported conflict scenarios. No normal offline action is blocked by network. Sync diagnostics identify stuck changes without exposing sensitive content.

## AI execution prompt
Build a deterministic sync test harness before polishing sync UI. Exercise conflicting offline edits and prove convergence. Keep network state out of core domain semantics and document every automatic conflict policy.
