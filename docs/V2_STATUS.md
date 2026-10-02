# v2.00 Calendar & Planning — Delivery Plan

## Goal

Complete the first-party calendar and advanced planning scope in Phases 7–9, validate the responsive web app on iPhone, iPad, and desktop, and release the completed checkpoint as v2.00.

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

## Current status (2026-10-02)

- Phase 7 is implemented and merged into `v1.01` (PR #77): local calendars, standalone all-day and timed events, recurrence, and calendar visibility.
- Phase 8 is implemented and merged into `v1.02` (PR #78): scheduled work blocks, task-to-calendar scheduling, editing, removal, restoration, and undo. Domain tests assert that scheduling does not modify task deadlines.
- Phase 9 merged into `v1.03` (PRs #79–#81): Kanban grouping, saved filters, bulk task actions, task and event templates, routines, schema v3 migration, and compact due-time captions. Web tests, typecheck, lint, production build, Swift core tests, Apple build, Apple migration tests, and the Apple UI smoke suite passed in the `v1.03` CI run.
- Due-time captions use compact 12-hour labels such as `Due 9:15am` and `Due 5:30pm` in web and Apple calendar task views.
- `v2.00` was created from the green `v1.03` checkpoint. Its required CI passed on `3312fd8` after the Apple UI smoke-test adjustment (run #36945870588).
- The v2.00 interaction polish merged in PRs #86–#88: custom month grids/day timelines, app-styled option/date/time selectors, matched date/time widths, and no-autofocus task creation on Apple and web.
- Native iOS builds and simulator UI tests are removed from GitHub Actions because the unsigned simulator product cannot be installed on physical devices from a GitHub download. `apps/apple` remains experimental source; the supported iPhone/iPad path for v2.00 is the responsive web app added to the Home Screen. The required `apple` check now documents this policy without compiling the app.
- The latest Apple UI test exposed a deadline-selector visibility issue in the test sequence. The test now checks the switch state and scrolls the form to the date row before querying it; this change cannot be verified in Xcode in this environment, so native app behavior remains outside the v2.00 CI gate.
- PR #93 promoted the web editor autofocus fix to `main` commit `40ab527`; Cloudflare production build `47802004-3e78-4d67-9aff-4f74479b8cec` succeeded (version `c75eab90-2aa5-41f6-8ffe-bbd8b4869839`). Production browser smoke testing confirmed opening New task leaves the title field unfocused, so the keyboard does not open automatically.
- Manual validation of the responsive web app on iPhone, iPad, and desktop remains outstanding. Native iOS installation/build validation is not part of this release.

## Release gate

- [x] Phase 7 implementation merged into `v1.01`.
- [ ] After deployment, Phase 7 manual checks pass on iPhone, iPad, and web, including calendar/event persistence, recurrence, time-zone and DST behavior, accessibility, and overlap handling.
- [x] Phase 8 implementation merged into `v1.02`; automated tests cover scheduling without due-date changes.
- [ ] After deployment, Phase 8 manual checks pass for touch, pointer, keyboard, undo, offline persistence, and calendar/Dashboard consistency.
- [x] Phase 9 implementation merged into `v1.03`; local web checks and version-branch CI pass.
- [ ] After deployment, Phase 9 manual checks pass across supported clients, including accessibility and migration behavior.
- [x] Web, Swift core, docs, and Apple-build-policy checks pass on the current `v2.00` head; phase documentation matches the release candidate.
- [x] Promote the v2.00 editor autofocus fix through PR #93 and verify the Cloudflare production deployment.
- [ ] Complete and record responsive-web manual checks on iPhone, iPad, and desktop against the deployed build, including Home Screen install, offline persistence, accessibility, layout, calendar behavior, and notifications.
