# Phase 2 — Tasks, Inbox & Local Persistence
**Target:** v1.00

## Objective
Deliver reliable local task capture/edit/completion and an Inbox that remains fully usable offline.

## Scope
Implement Task, Project-minimum references, priority, notes, date-only/time deadlines, completion state, stable ordering and local persistence/migrations. Build Inbox quick capture, task detail/editor, completion/undo, deletion with recoverable/tombstone semantics, and basic list virtualization.

## Behavioral rules
A deadline is not scheduled work. Date-only due values remain calendar dates. Task identity is UUID and never changes after creation. Completion timestamps are recorded. Editing title/notes must not accidentally alter ordering or due semantics. Deletion should be compatible with future sync. Quick add optimizes for title-first capture and permits later organization.

## Persistence
Use repository protocols from Phase 1. Transactions must make local writes atomic. Define migration tests. Seed/demo data exists only in debug/test configuration. Avoid storage models leaking into views.

## UX
Inbox shows unorganized active tasks with immediate add, complete, edit and reorder. Task editor supports title, notes, priority and deadline. Destructive actions use platform-appropriate confirmation/undo without excessive dialogs. Preserve focus for rapid capture.

## Tests
CRUD; restart persistence; migration fixture; ordering; completion/undo; delete/tombstone; date-only deadline; timed deadline; invalid/empty title policy; concurrent local view updates; large-list query performance sanity.

## Acceptance criteria
- User can capture, edit, complete and delete tasks without network.
- Relaunch preserves state.
- UUID/revision/timestamps are populated consistently.
- Date-only tasks do not shift because of timezone conversion.
- Inbox remains responsive with realistic task counts.
- Automated tests cover persistence and domain behavior.

## Manual validation
Airplane/offline mode, force quit/relaunch, rapid additions, swipe/keyboard actions, VoiceOver labels, Dynamic Type, iPad keyboard.

## AI execution prompt
Audit and implement Phase 2 on a new temporary branch from the active version branch. Treat DATA_MODEL.md as canonical. Do not implement server sync. Validate migrations and offline behavior, review for persistence/UI coupling, resolve CI/review findings, and merge back only after acceptance criteria are satisfied.
