# Architecture

## Decision summary
Ship the responsive React/Next.js web app as the supported client on desktop, iPhone, and iPad. The `apps/apple` SwiftUI project is experimental source and is not built or distributed by CI. Keep domain semantics platform-neutral through documented schemas and fixtures. Browser data is local-first; accounts and cross-device task synchronization are planned for v3. PostgreSQL is a candidate, not a selected or deployed backend.

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
### Experimental Apple source
`apps/apple` contains SwiftUI code and a platform-neutral Swift core. Native builds and distribution are disabled in the current workflow. Any future decision to support that app requires an explicit product and validation decision.

### Web
TypeScript, React/Next.js, IndexedDB for offline local state, a tested domain package, and Node-based UI/domain tests. Cloudflare Workers serves the production web app; the current CI production build uses Vinext.

### Backend (planned v3)
No task-data sync service is deployed. Phase 10 must select the backend/auth model through an ADR and specify a versioned incremental sync protocol before implementation; PostgreSQL is a proposal only.

## Time model
Persist instants in UTC where an instant exists, plus time-zone identifiers where local calendar semantics matter. Date-only deadlines must remain date-only and must not be converted into arbitrary midnight instants. All-day events use calendar dates. Recurrence evaluation must specify calendar/time zone and DST behavior.

## Sync-ready metadata
Every syncable record should include stable UUID, owner ID when accounts exist, createdAt, updatedAt, revision/version, deletedAt/tombstone state. Avoid database-generated identifiers as public identity.

## Security
No secrets in clients/repository. Use platform secure storage for credentials/tokens. Validate all server authorization independently of client claims. Treat attachment URLs as protected resources. Dependency and secret scanning belong in CI when code exists.

## ADRs
Architecturally significant deviations require an ADR under `docs/adr/` describing context, decision, alternatives and consequences.

## Platform icons
The Apple app icon is the opaque 1024×1024 PNG in `apps/apple/LTMTodo/Assets.xcassets/AppIcon.appiconset`, selected by the XcodeGen target's `ASSETCATALOG_COMPILER_APPICON_NAME` setting. The web client provides a 180×180 Apple touch icon and Apple-branded favicon for search/browser surfaces, plus a 192×192 PNG and 512×512 WebP in its standalone web-app manifest. The original transparent 512×512 WebP remains under `apps/web/public/icons` as the web-specific icon.
