# Web Domain Data Model

This describes the current local web schema (`schemaVersion: 4`) in `apps/web/lib/domain.ts`. It is an IndexedDB document, not a server schema. Future sync records and protocol fields are proposals until Phase 10/11.

## Shared entity fields

Most persistent entities have `id` (UUID), `createdAt`, `updatedAt`, `revision`, and optional `deletedAt`. The top-level document has `generation` for cross-tab write detection. There is no owner ID, change journal, sync state, or account identity today.

## Entities

- **Task:** title, notes, priority, optional project/section/parent IDs, tag IDs, sort key, optional date-only due date, optional local due time and time zone, completion timestamp, and optional structured recurrence.
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

## Future synchronization model

A server-side change journal, ownership model, cursor, conflict policy, and protocol do not exist yet. Phase 10 must define them; Phase 11 implements device convergence while local writes remain available offline. Preserve stable IDs and revisions, and do not treat the proposed sync model as part of schema v4 currently stored in IndexedDB.

External calendar subscriptions are also future v3 data and are not represented in schema v4. Phase 10 must define an account-owned subscription record, protected storage for its HTTPS feed URL, and source identity metadata. Phase 11 may materialize fetched events in a separate read-only source calendar; subscription refresh must update/cancel events by stable source UID without converting them to editable local events or tasks.