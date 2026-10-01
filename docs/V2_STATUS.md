# v2.00 Calendar & Planning — Delivery Plan

## Goal

Complete the first-party calendar and advanced planning scope in Phases 7–9, validate it on iPhone, iPad, and web, and release the completed checkpoint as v2.00.

Google Calendar is not a dependency. Tasks, scheduled work blocks, and calendar events remain distinct concepts. Scheduling work must never change a task's due date.

## Phase checkpoints

Each phase gets its own permanent major checkpoint. Later checkpoints are created from the preceding checkpoint after that phase is complete and validated, so the history remains cumulative.

| Checkpoint | Phase | Scope | Starting point |
| --- | --- | --- | --- |
| `v1.01` | Phase 7 | First-party calendars and events | `v1.00` |
| `v1.02` | Phase 8 | Scheduling, time blocking, calendar interactions | Completed `v1.01` |
| `v1.03` | Phase 9 | Kanban, routines, templates, smart views, planning polish | Completed `v1.02` |
| `v2.00` | Release | Complete, validated v2 calendar and planning system | Completed `v1.03` |

Implementation and fixes occur on temporary branches from the active phase checkpoint. Merge completed temporary branches into their originating checkpoint after validation. Keep every major checkpoint permanently. Production deployment remains restricted to `main`; promote the completed `v2.00` release through a version-to-main pull request.

## Current status (2026-10-01)

- Phase 7 is implemented and merged into `v1.01` (PR #77): local calendars, standalone all-day and timed events, recurrence, and calendar visibility.
- Phase 8 is implemented and merged into `v1.02` (PR #78): scheduled work blocks, task-to-calendar scheduling, editing, removal, restoration, and undo. Domain tests assert that scheduling does not modify task deadlines.
- Phase 9 is being completed on `feat/v1.03-phase9-advanced-planning`, based on `v1.03`: Kanban grouping, saved filters, bulk task actions, task and event templates, routines, and schema v3 migration. Web tests, typecheck, lint, and production build pass locally; Apple builds require Xcode and remain unverified in this environment.
- Due-time captions use compact 12-hour labels such as `Due 9:15am` and `Due 5:30pm` in web and Apple calendar task views.
- No `v2.00` release branch has been created yet. It is created only after Phase 9 is merged into `v1.03` and the checkpoint CI result is confirmed.

## Release gate

- [x] Phase 7 implementation merged into `v1.01`.
- [ ] Phase 7 manual checks pass on iPhone, iPad, and web, including calendar/event persistence, recurrence, time-zone and DST behavior, accessibility, and overlap handling.
- [x] Phase 8 implementation merged into `v1.02`; automated tests cover scheduling without due-date changes.
- [ ] Phase 8 manual checks pass for touch, pointer, keyboard, undo, offline persistence, and calendar/Dashboard consistency.
- [ ] Phase 9 implementation merged into `v1.03`; web automated tests pass locally for planning behavior and migration.
- [ ] Phase 9 manual checks pass across supported clients, including accessibility and migration behavior.
- [ ] Create `v2.00` from the validated `v1.03` checkpoint; run its required CI and confirm all phase documentation matches the shipped behavior.
- [ ] Promote `v2.00` to `main` through a pull request and verify the production deployment.
