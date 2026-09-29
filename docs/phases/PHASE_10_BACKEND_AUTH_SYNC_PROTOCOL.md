# Phase 10 — Backend, Authentication & Sync Protocol
**Target:** v3.00

## Objective
Introduce accounts and a secure synchronization service without sacrificing offline-first behavior.

## Scope
Backend service; PostgreSQL schema/migrations; authentication/session model; authorization; versioned API; incremental pull/push protocol; change journal integration; tombstones; idempotency; cursor/checkpoint model; server validation; rate/abuse controls appropriate to personal app scale; observability.

## Sync protocol
Clients send stable entity IDs and base revisions. Server returns authoritative revisions and incremental changes after a cursor. Retries must be idempotent. Tombstones propagate. Never use client clocks alone for conflict authority. Define schema/version negotiation.

## Security
Server independently enforces ownership. Password/session/token approach must follow current platform security practices at implementation time. Secrets only in deployment secret stores. Log metadata without leaking task content unnecessarily.

## Tests
Authz isolation; idempotent retry; duplicate delivery; out-of-order changes; tombstones; stale base revision; migration; cursor pagination; interrupted sync; malformed payload; rate behavior.

## Acceptance criteria
A sync protocol specification exists and is tested before all clients depend on it. Local app remains usable while server is unavailable. One account cannot read/write another account's data.

## AI execution prompt
Before coding, add an ADR for selected backend/auth technologies and threat-model the sync boundary. Implement protocol tests and authorization tests as first-class requirements. Never replace local-first writes with request/response UI blocking.
