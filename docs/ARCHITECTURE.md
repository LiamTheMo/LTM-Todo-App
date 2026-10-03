# Architecture

## Decision summary
Ship the responsive React/Next.js web app as the supported client on desktop, iPhone and iPad. Users can add it to the Home Screen on supported mobile browsers. Browser data is local-first; accounts and cross-device task synchronization are planned for v3. No native Apple application or Swift development project is maintained in this repository. PostgreSQL is a candidate, not a selected or deployed backend.

## Layers
1. **Presentation:** React/Next.js web views and responsive navigation.
2. **Application:** use cases such as CompleteTask, ScheduleTask, MoveTask and QueryDashboard.
3. **Domain:** Task, Project, Event, recurrence, reminder and ordering rules. No framework dependencies.
4. **Persistence:** local repositories and migrations.
5. **Sync:** change journal, remote transport and conflict resolution; dormant/contract-only before v3.
6. **Web platform services:** notifications, background work and sharing.

## Local-first invariant
A user must be able to launch, browse, create, edit, schedule and complete locally available tasks without a server round trip. UI writes update local state transactionally. Future sync observes committed local changes and propagates them asynchronously.

## Suggested technology
TypeScript, React/Next.js, IndexedDB for offline local state, a tested domain package, and Node-based UI/domain tests. Cloudflare Workers serves the production web app; the current CI production build uses Vinext.

### Backend (planned v3)
No task-data sync service or external-calendar feed service is deployed. Phase 10 must select the backend/auth model through an ADR and specify a versioned incremental sync protocol before implementation; PostgreSQL is a proposal only. It must also define the authenticated feed-fetch/cache boundary for read-only HTTPS iCalendar subscriptions. Feed URLs can be bearer secrets: store them encrypted, restrict access to the owning account, and prevent arbitrary-URL fetches from reaching private or link-local networks. Never log full feed URLs or credentials.

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
