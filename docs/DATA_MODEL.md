# Web Domain Data Model

This describes the local web schema (`schemaVersion: 4`) in `apps/web/lib/domain.ts` and the separate v3 server sync model. The local document remains in IndexedDB; the v3 protocol mirrors supported entities into account-owned D1 records. The v3 backend/client are implemented locally but are not yet deployed.

## Shared entity fields

Most persistent entities have `id` (UUID), `createdAt`, `updatedAt`, `revision`, and optional `deletedAt`. The top-level document has `generation` for cross-tab write detection. Account identity is held by the authenticated session, not copied into entity payloads. The local document and sync outbox/cursor are stored separately in IndexedDB.

## Entities

- **Task:** title, notes, priority (`low`, `medium`, or `high`; new and legacy unprioritized tasks use `low`), optional project/section IDs, tag IDs, sort key, optional date-only due date, optional local due time and time zone, completion timestamp, and optional structured recurrence.
- **Project / Section / Tag:** named organization records; projects and sections carry sort keys, tags have colors, and projects may be archived.
- **ScheduledBlock:** task ID, start/end instants, and time zone. Scheduling is separate from a task's due date. The current editor supports a scheduled block per scheduling operation; multiple simultaneous work blocks per task and drag/drop scheduling are not shipped.
- **LocalCalendar:** name, canonical `#RRGGBB` sRGB color (each 8-bit channel ranges from 0 to 255), visibility, and sort key. A default Personal calendar is created locally.
- **CalendarEvent:** calendar ID, title, notes, optional recurrence, and either all-day start/end dates (end exclusive) or timed start/end instants with a time zone.
- **Reminder:** task ID, minutes-before trigger, and enabled state. Event reminders are not in the current web schema.
- **Completion:** task ID, optional recurrence occurrence date, completion instant, and IDs of scheduled blocks cleared on completion.
- **SavedView:** query and optional project, priority, tag, date-scope, and completion filters.
- **TaskTemplate / EventTemplate / Routine:** local templates and routine records used to create new task/event identities or recurring tasks.

## Top-level document

The `Data` document contains `schemaVersion`, `generation`, and arrays for tasks, projects, sections, tags, scheduled blocks, calendars, calendar events, templates, routines, reminders, completions, and saved views. Persistence and normalization live in `apps/web/lib/storage.ts`.

## Time and deletion

Date-only task deadlines remain `YYYY-MM-DD` values and are not converted to UTC midnight. Timed values retain local time-zone context. Timed calendar events store instants; all-day events use date values. Recurrence stores frequency, interval, optional weekdays/until/count, and for tasks anchor date/occurrence count.

Entity `deletedAt` fields support local deletion semantics. The web client prunes expired Dashboard history to Today plus the previous 30 local calendar dates, including old due tasks, completions, and scheduled blocks/events according to their date rules.

## Server synchronization model

The v1 sync protocol mirrors the listed entity types into account-scoped D1 rows. D1 stores revisions, tombstones, idempotency results, and an ordered change journal; opaque account-scoped cursors drive incremental pulls. The Durable Object serializes each account's sync requests. Client writes remain local-first and are queued in a separate IndexedDB journal. Attachments are stored in R2 with D1 metadata and are not embedded in task payloads.

## External calendar subscriptions

ICS subscriptions live in a separate account-owned D1 table, not in the editable entity-sync payload. The source HTTPS URL is an encrypted bearer secret; validators, refresh timestamps, backoff state, and a bounded event cache are stored server-side. Refreshes run through the Worker and a pinned-address TLS transport; clients never fetch arbitrary feed URLs directly.

The client persists a bounded cached subscription response for offline display. Feed-derived CalendarEvent projections are ephemeral and read-only: they use the source UID and original recurrence identity for stable rendering but are not written to the editable `calendarEvents` collection. Subscription URLs, cached feed text/events, and attachment bytes are excluded from portable backups. User-owned calendar metadata may be present locally for presentation, but subscription credentials are never part of the sync entity payload.

Production DNS/TLS socket behavior and provider compatibility remain a live validation gate before enabling the service on `main`.
