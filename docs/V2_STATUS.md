# v2.00 Calendar & Planning — Release Status

## Goal

Deliver a first-party local calendar and planning experience in the responsive web app. Tasks, planned-work blocks, and calendar events remain distinct. Scheduling must not change a task's due date. The native SwiftUI project is experimental and is not part of the supported release path.

## Phase checkpoints

| Checkpoint | Phase | Scope | Status |
| --- | --- | --- | --- |
| `v1.01` | 7 | First-party calendars and events | Implemented locally |
| `v1.02` | 8 | Scheduled work and time blocking | Implemented with form-based interactions |
| `v1.03` | 9 | Kanban, routines, templates, saved views, planning polish | Implemented locally |
| `v2.00` | Release | Integrate and validate the calendar/planning system | Promoted to `main`; manual web validation remains |

All development used temporary branches, then merged into the active permanent phase checkpoint. Version branches remain permanent. Cloudflare deployment is main-only.

## Shipped in v2.00

- First-party local calendars and events, including all-day/timed events, recurrence, calendar visibility, and custom in-app calendar creation.
- Six-week month grid with event/task previews, month navigation, selected-day agenda, and chronological timeline.
- The separate Month/Week/Day/Agenda selector was removed. No separate week or agenda mode is shipped.
- The +Calendar form uses an in-app full-spectrum calendar color wheel with 8-bit RGB channels (0–255 each); named legacy colors migrate to their previous hex values.
- Planned-work blocks can be created, edited, and removed. Scheduling is distinct from a due date. Drag/drop scheduling and multiple concurrent blocks per task are not shipped.
- Kanban, task/event templates, routines, saved views, and bulk task actions.
- App-styled web data controls; New Task leaves the title unfocused until tapped.
- Due-time captions use 12-hour labels such as `Due 9:15am` / `Due 5:30pm`.

## Release and checks

- The v2.00 implementation was promoted to `main` through PR #114; Cloudflare Workers Builds deploys the production site from `main`.
- The `v2.00` branch CI gate runs `web`, `swift-core`, `docs`, and the Apple no-native-build policy check. Current results and logs are recorded in GitHub Actions.
- The Swift job emits a Node.js 20 deprecation warning because `swift-actions/setup-swift` declares Node 20. Stable v2.4.0 and prerelease v3.0.0-beta.1 both declare Node 20; the current action remains because the Swift tests pass and the beta does not resolve the warning.
- The production web implementation includes the custom calendar color wheel and calendar view cleanup. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for verified behavior and explicit gaps.

## Remaining v2 release validation

- [ ] Finish manual responsive-web validation on iPhone, iPad, and desktop against the deployed build: calendar/event persistence and recurrence, time zones/DST, accessibility, touch/keyboard/pointer navigation, Home Screen install, offline behavior, layout, and notifications.
- [ ] Record any issues found and fix them on a temporary branch from `v2.00`, then wait for all required checks before promoting the fix to `main`.

Native installation/build validation is not part of the current release gate.