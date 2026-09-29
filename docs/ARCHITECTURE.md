# Architecture

## Decision summary
Use a native SwiftUI application for iPhone/iPad and a React/Next.js web client. Keep domain semantics platform-neutral through documented schemas and fixtures. v1 is local-first. v3 adds a PostgreSQL-backed synchronization service.

## Layers
1. **Presentation:** SwiftUI / React views and navigation.
2. **Application:** use cases such as CompleteTask, ScheduleTask, MoveTask, QueryDashboard.
3. **Domain:** Task, Project, Event, recurrence, reminder and ordering rules. No framework dependencies.
4. **Persistence:** local repositories and migrations.
5. **Sync:** change journal, remote transport, conflict resolution; dormant/contract-only before v3.
6. **Platform services:** notifications, background work, widgets, sharing.

## Local-first invariant
A user must be able to launch, browse, create, edit, schedule and complete locally available tasks without a server round trip. UI writes update local state transactionally. Future sync observes committed local changes and propagates them asynchronously.

## Suggested technology
### Apple
Swift, SwiftUI, SwiftData or SQLite-backed persistence selected after prototype benchmarking, XCTest/Swift Testing. Repository interfaces isolate persistence choice.

### Web
TypeScript, Next.js/React, IndexedDB for offline local state, a tested domain/application package, Playwright for critical UI flows.

### Backend (v3)
TypeScript or another deliberately selected server runtime; PostgreSQL; authenticated versioned API; incremental synchronization endpoint. The exact server framework requires an ADR before implementation.

## Time model
Persist instants in UTC where an instant exists, plus time-zone identifiers where local calendar semantics matter. Date-only deadlines must remain date-only and must not be converted into arbitrary midnight instants. All-day events use calendar dates. Recurrence evaluation must specify calendar/time zone and DST behavior.

## Sync-ready metadata
Every syncable record should include stable UUID, owner ID when accounts exist, createdAt, updatedAt, revision/version, deletedAt/tombstone state. Avoid database-generated identifiers as public identity.

## Security
No secrets in clients/repository. Use platform secure storage for credentials/tokens. Validate all server authorization independently of client claims. Treat attachment URLs as protected resources. Dependency and secret scanning belong in CI when code exists.

## ADRs
Architecturally significant deviations require an ADR under `docs/adr/` describing context, decision, alternatives and consequences.
