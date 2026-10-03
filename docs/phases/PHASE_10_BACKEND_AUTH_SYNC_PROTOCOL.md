# Phase 10 — Backend, Authentication & Sync Protocol
**Target:** v3.00

## Objective
Introduce accounts and a secure synchronization service without sacrificing offline-first behavior.

## Scope
Backend service; PostgreSQL schema/migrations; authentication/session model; authorization; versioned API; incremental pull/push protocol; change journal integration; tombstones; idempotency; cursor/checkpoint model; server validation; rate/abuse controls appropriate to personal app scale; observability.

## External calendar feed design
Define the v3 data model and threat boundary for read-only HTTPS iCalendar (ICS) subscriptions before implementation. Subscription records are owned by an authenticated account and reference a source URL that may function as a bearer secret. Specify encryption at rest, authorization, redaction from logs, refresh policy, cache validators, source identity and cancellation handling.

The feed fetcher must reject unsafe schemes and destinations, revalidate redirect targets, prevent access to private/link-local networks, and enforce response-size, timeout and refresh-rate limits. Choose a supported ICS feature set for time zones, recurrence, cancellations and malformed feeds. The initial design is one-way and read-only; Google-account OAuth and write-back are out of scope.

## Sync protocol
Clients send stable entity IDs and base revisions. Server returns authoritative revisions and incremental changes after a cursor. Retries must be idempotent. Tombstones propagate. Never use client clocks alone for conflict authority. Define schema/version negotiation.

## Security
Server independently enforces ownership. Password/session/token approach must follow current platform security practices at implementation time. Secrets only in deployment secret stores. Log metadata without leaking task content unnecessarily.

## Tests
Authz isolation; idempotent retry; duplicate delivery; out-of-order changes; tombstones; stale base revision; migration; cursor pagination; interrupted sync; malformed payload; rate behavior. Feed-security tests must cover SSRF/private-network attempts, redirects, oversized/slow responses, unauthorized subscription access, URL redaction and refresh throttling.

## Acceptance criteria
A sync protocol specification exists and is tested before all clients depend on it. A secure feed-fetching/storage design is approved and tested before subscriptions are enabled. Local app remains usable while server is unavailable. One account cannot read/write another account's data or subscription URLs.

## AI execution prompt
Before coding, add an ADR for selected backend/auth technologies and threat-model the sync boundary. Implement protocol tests and authorization tests as first-class requirements. Never replace local-first writes with request/response UI blocking.
