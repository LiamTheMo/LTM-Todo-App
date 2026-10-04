# Architecture

## Decision summary
Ship the responsive React/Next.js web app as the supported client on desktop, iPhone and iPad. Users can add it to the Home Screen on supported mobile browsers. Browser data is local-first; v3 adds optional account sync. No native Apple application or Swift development project is maintained in this repository. The v3 backend code uses Cloudflare Workers, D1, a per-account Durable Object coordinator, R2, and managed OpenID Connect; it is implemented locally but not deployed or validated against production resources.

## Layers
1. **Presentation:** React/Next.js web views and responsive navigation.
2. **Application:** use cases such as CompleteTask, ScheduleTask, MoveTask and QueryDashboard.
3. **Domain:** Task, Project, Event, recurrence, reminder and ordering rules. No framework dependencies.
4. **Persistence:** local repositories and migrations.
5. **Sync:** change journal, remote transport and conflict resolution; implemented locally for v3, not active in deployed `main`.
6. **Web platform services:** notifications, background work and sharing.

## Local-first invariant
A user must be able to launch, browse, create, edit, schedule and complete locally available tasks without a server round trip. UI writes update local state transactionally. Future sync observes committed local changes and propagates them asynchronously.

## Suggested technology
TypeScript, React/Next.js, IndexedDB for offline local state, a tested domain package, and Node-based UI/domain tests. Cloudflare Workers serves the production web app; the current CI production build uses Vinext.

### Web
TypeScript, Next.js/React, IndexedDB for offline local state, a tested domain/application package, Playwright for critical UI flows.

### Backend (v3)
TypeScript on the existing Cloudflare Worker; D1 for sync and notification data in separate databases; a per-account Durable Object to serialize sync operations; R2 for attachment bytes; managed OpenID Connect for authentication; authenticated versioned APIs. See [ADR 0003](adr/0003-v3-sync-backend.md). The production identity provider and Cloudflare resource IDs remain deployment choices.

The local v3 implementation includes task-data sync and a read-only external-calendar feed service; neither is deployed in `main` yet. ICS feed URLs are bearer secrets: they are encrypted at rest, restricted to their owning account, fetched only through DNS validation and a connection-pinned TLS transport, and never logged. Live Cloudflare socket behavior remains a production smoke-test gate. See Phase 11 for the feed/cache contract.

## Time model
Persist instants in UTC where an instant exists, plus time-zone identifiers where local calendar semantics matter. Date-only deadlines must remain date-only and must not be converted into arbitrary midnight instants. All-day events use calendar dates. Recurrence evaluation must specify calendar/time zone and DST behavior.

## Sync-ready metadata
Every syncable record should include stable UUID, owner ID when accounts exist, createdAt, updatedAt, revision/version, deletedAt/tombstone state. Avoid database-generated identifiers as public identity.

## Security
No secrets in clients/repository. Validate all server authorization independently of client claims. Treat attachment URLs and external calendar feed URLs as protected resources. Feed ingestion must constrain schemes, redirects, destination networks, response size, timeouts, refresh rate and logging. Dependency and secret scanning belong in CI when code exists.

## ADRs
Architecturally significant deviations require an ADR under `docs/adr/` describing context, decision, alternatives and consequences.

## Web app icons
The web client provides a touch icon and browser favicon for Home Screen/browser surfaces, plus its standalone web-app manifest icons. These are web resources and do not imply a separate native app.
