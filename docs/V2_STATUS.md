# v2.00 Calendar & Planning — Release Status

## Goal
Deliver a first-party local calendar and planning experience in the responsive web app. Tasks, planned-work blocks and calendar events remain distinct. Scheduling must not change a task's due date.

## Phase checkpoints
| Checkpoint | Phase | Scope | Status |
| --- | --- | --- | --- |
| `v1.01` | 7 | First-party calendars and events | Implemented locally |
| `v1.02` | 8 | Scheduled work and time blocking | Implemented with form-based interactions |
| `v1.03` | 9 | Kanban, routines, templates, saved views, planning polish | Implemented locally |
| `v2.00` | Release | Integrate and validate the calendar/planning system | Promoted to `main`; manual web validation remains |

All development used temporary branches, then merged into the active permanent phase checkpoint. Version branches remain permanent. Cloudflare deployment is main-only.

## Shipped in v2.00
- First-party local calendars and events, including all-day/timed events, recurrence, visibility, in-app creation, and calendar rename/recolor editing.
- Six-week month grid with event/task previews, month navigation, selected-day agenda, and chronological timeline.
- The separate Month/Week/Day/Agenda selector was removed. No separate week or agenda mode is shipped.
- The +Calendar form uses an in-app full-spectrum calendar color wheel with 8-bit RGB channels (0–255 each). Pointer selection matches the visible hue spectrum; named legacy colors migrate to their previous hex values.
- Planned-work blocks can be created, edited and removed. Scheduling is distinct from a due date. Drag/drop scheduling and multiple concurrent blocks per task are not shipped.
- Tasks uses a status-based Kanban with text search. Other task filters, saved-view controls and bulk actions have been removed from that page.
- Task, event templates and routines.
- App-styled web data controls; New Task leaves the title unfocused until tapped. The date picker opens to the current month and marks today.
- Due-time captions use 12-hour labels such as `Due 9:15am` / `Due 5:30pm`.

## Release and checks
- The current v2.00 implementation is promoted to `main`; Cloudflare Workers Builds deploys the production site from `main`.
- The version-branch CI gate runs `web` and `docs`. Web checks include dependency audit, tests, typecheck, lint and a production build.
- Native Swift and Xcode app source, tests and build workflows have been removed; the repository maintains the responsive web client only.
- Current results and logs are available in GitHub Actions. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for verified behavior and explicit gaps.

## Dashboard updates
- In the v2.00 checkpoint, dated tasks and scheduled work stayed in Dashboard day groups, overdue tasks remained in Overdue, and tasks without due dates stayed in Tasks. v3.02 later added the Other Tasks Dashboard panel; see [DASHBOARD_UX.md](DASHBOARD_UX.md) for current behavior.
- Dashboard history retains 31 calendar days: today plus the previous 30 days.

## Remaining v2 release validation
- [ ] Finish manual responsive-web validation on iPhone, iPad and desktop against the deployed build: calendar/event persistence and recurrence, time zones/DST, accessibility, touch/keyboard/pointer navigation, Home Screen install, offline behavior, layout and notifications.
- [ ] Record any issues found and fix them on a temporary branch from `v2.00`, then wait for all required checks before promoting the fix to `main`.
