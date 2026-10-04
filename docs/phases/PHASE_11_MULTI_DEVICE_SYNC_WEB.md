# Phase 11 — Multi-Device Sync, Conflict Resolution & Web Production Client
**Checkpoint:** `v2.02`
**Target release:** `v3.00`

## Objective
Make the supported web/PWA app converge reliably across desktop, iPhone, and iPad installs while remaining usable offline. Native Apple app source is not maintained in the repository.

## Scope
Web sync adapter; IndexedDB/local journal; background/foreground synchronization; conflict detection/resolution; retry/backoff; sync status diagnostics; session management; schema migration compatibility. The web production client already exists; this phase adds account and synchronization behavior to it.

## Read-only calendar subscriptions
Let a user add an HTTPS ICS feed URL as a separately managed subscribed calendar. Parse and refresh it through the authenticated backend; use ETag and Last-Modified when supported, apply bounded polling/backoff, and show last refresh plus recoverable errors. Display events in month previews, day agenda and timeline with calendar visibility/color controls. Let users refresh or unsubscribe. Keep remote events read-only and identify them by subscription ID plus source UID so repeated refreshes update rather than duplicate entries. Apply source cancellations/deletions and preserve recurrence/time-zone semantics supported by the Phase 10 contract.

Do not add provider OAuth or write-back in this phase's first release. Feed refresh must not block local use, and device sync must propagate subscription settings and stable external event state without exposing feed URLs to other accounts.

Also add optional, read-only HTTPS ICS calendar subscriptions. Store subscription configuration separately from editable local calendars; provide add, show/hide, recolor, refresh, and unsubscribe controls. The Worker fetches and caches feeds on the server. Clients never fetch arbitrary feed URLs directly, and imported events cannot be edited as first-party events.

Validate subscription URLs and every redirect/connection to prevent SSRF, including private, loopback, link-local, and metadata-service addresses. Enforce HTTPS, redirect limits, response-size and parse-time limits, refresh throttling, safe XML/iCalendar parsing, and cache validators. Do not expose feed URLs or event text in logs. User-controlled fetch targets must be resolved and checked at connection time to mitigate DNS rebinding.

## Conflict policy
Define per-entity/field policy deliberately. Do not use blanket last-write-wins for destructive or structurally conflicting changes without analysis. Preserve user work where possible and expose actionable conflicts only when automatic resolution would be unsafe.

## Failure cases
Two devices edit same task; offline completion vs remote delete; project move vs archive; recurrence edits; reordered lists; stale client version; server outage; token expiration; partial batch upload; feed timeout or invalid ICS; changed ETag; event cancellation; recurrence/time-zone edge cases; revoked or rotated feed URL; refresh throttling.

## Tests
Multi-device simulation with deterministic journals; convergence/property tests; retry/idempotency; conflict fixtures; offline web reload; browser storage migration; auth expiration. Test ICS parsing and recurrence, stable-UID upserts, cancellations, conditional refresh, visibility, failure/backoff behavior and subscription isolation between accounts.

## Acceptance criteria
Two or more web/PWA installs eventually converge under supported conflict scenarios. Users can subscribe to, display, refresh and unsubscribe from read-only ICS feeds. A refresh does not create duplicates or turn remote events into local tasks. No normal offline action is blocked by network. Sync diagnostics identify stuck changes without exposing task content or feed URLs.

## Current status (2026-10-04)
The local implementation is complete and automated tests cover sign-in/session controls, atomic IndexedDB journal writes, bounded background push/pull with backoff, per-profile account binding, explicit local/remote conflict choices, snapshot recovery, and account-scoped device registration/cursor acknowledgement/retirement. Production parity and live multi-device validation remain open.

ICS subscription storage, refresh controls, encrypted URL handling, conditional refresh/backoff, offline cache integration, and the pinned-address TLS transport are implemented and tested locally. The transport pins a previously validated literal address, retains the original hostname for SNI/certificate verification, rejects redirects inside the transport, and revalidates each redirect at the service boundary. Keep production feed activation gated on a live Cloudflare Worker smoke test proving DNS resolution, socket peer identity, and TLS certificate validation; build success alone is not that proof.

ICS events are displayed as separate read-only calendar projections, including recurrence overrides and cancellations, and are not persisted as editable first-party events. Unsafe URLs and malformed/oversized feeds fail closed without blocking local use.

Sharing/collaboration is not part of this phase's initial release; it remains deferred pending an explicit membership and role model.

## AI execution prompt
Build a deterministic sync test harness before polishing sync UI. Exercise conflicting offline edits and prove convergence. Keep network state out of core domain semantics and document every automatic conflict policy.
