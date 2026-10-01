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

## Audit snapshot

- v2 implementation work has not started on a v2 checkpoint.
- The web client has a monthly calendar grid and a selected-day agenda for existing tasks and scheduled work. The Apple client has a selected-day calendar surface.
- The existing calendar surfaces do not provide standalone event management.
- The task/scheduled-block model and existing saved views provide foundations, but do not complete the Phase 8 interactions or Phase 9 planning features.
- The detailed requirements and acceptance criteria remain in [Phases 7–9](phases/).

## Release gate

- [ ] Phase 7 acceptance criteria implemented on `v1.01`; automated checks pass; review findings resolved.
- [ ] Phase 7 manual checks pass on iPhone, iPad, and web, including calendar/event persistence, recurrence, time-zone and DST behavior, accessibility, and overlap handling.
- [ ] Phase 8 acceptance criteria implemented on `v1.02`; automated checks prove scheduling leaves due dates unchanged.
- [ ] Phase 8 manual checks pass for touch, pointer, keyboard, undo, offline persistence, and calendar/Dashboard consistency.
- [ ] Phase 9 acceptance criteria implemented on `v1.03`; automated checks pass for board moves, template identity, routine recurrence, smart views, and bulk-edit failure behavior.
- [ ] Phase 9 manual checks pass across supported clients, including accessibility and migration behavior.
- [ ] Create `v2.00` from the validated `v1.03` checkpoint; run its required CI and confirm all phase documentation matches the shipped behavior.
- [ ] Promote `v2.00` to `main` through a pull request and verify the production deployment.
