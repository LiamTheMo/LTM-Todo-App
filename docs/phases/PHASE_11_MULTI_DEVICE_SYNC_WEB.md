# Phase 11 — Multi-Device Sync, Conflict Resolution & Web Production Client
**Target:** v3.00

## Objective
Make a user's devices converge reliably while the web app remains usable offline.

## Scope
Web sync adapter; IndexedDB/local journal; background/foreground synchronization; conflict detection/resolution; retry/backoff; sync status diagnostics; session management; schema migration compatibility. The web production client already exists; this phase adds account and synchronization behavior to it.

## Read-only calendar subscriptions
Let a user add an HTTPS ICS feed URL as a separately managed subscribed calendar. Parse and refresh it through the authenticated backend; use ETag and Last-Modified when supported, apply bounded polling/backoff, and show last refresh plus recoverable errors. Display events in month previews, day agenda and timeline with calendar visibility/color controls. Let users refresh or unsubscribe. Keep remote events read-only and identify them by subscription ID plus source UID so repeated refreshes update rather than duplicate entries. Apply source cancellations/deletions and preserve recurrence/time-zone semantics supported by the Phase 10 contract.

Do not add provider OAuth or write-back in this phase's first release. Feed refresh must not block local use, and device sync must propagate subscription settings and stable external event state without exposing feed URLs to other accounts.

## Conflict policy
Define per-entity/field policy deliberately. Do not use blanket last-write-wins for destructive or structurally conflicting changes without analysis. Preserve user work where possible and expose actionable conflicts only when automatic resolution would be unsafe.

## Failure cases
Two devices edit same task; offline completion vs remote delete; project move vs archive; recurrence edits; reordered lists; stale client version; server outage; token expiration; partial batch upload; feed timeout or invalid ICS; changed ETag; event cancellation; recurrence/time-zone edge cases; revoked or rotated feed URL; refresh throttling.

## Tests
Multi-device simulation with deterministic journals; convergence/property tests; retry/idempotency; conflict fixtures; offline web reload; browser storage migration; auth expiration. Test ICS parsing and recurrence, stable-UID upserts, cancellations, conditional refresh, visibility, failure/backoff behavior and subscription isolation between accounts.

## Acceptance criteria
Multiple devices running the web app eventually converge under supported conflict scenarios. Users can subscribe to, display, refresh and unsubscribe from read-only ICS feeds. A refresh does not create duplicates or turn remote events into local tasks. No normal offline action is blocked by network. Sync diagnostics identify stuck changes without exposing task content or feed URLs.

## Current status (2026-10-02)
Not started. The deployed web app stores task data per browser and has no account or cross-device task sync. Web Push queues reminder delivery per install and is not sync. Start only after the v2.00 release gate is complete; Phase 10 must define and test the backend/auth/sync contract first.

## AI execution prompt
Build a deterministic sync test harness before polishing sync UI. Exercise conflicting offline edits and prove convergence. Keep network state out of core domain semantics and document every automatic conflict policy.
