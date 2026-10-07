# v3.03 — Sync Recovery and Calendar Composer

## Scope

This checkpoint inherits the deployed v3.02 state. It addresses cross-device sync stability and adds the existing selected-day schedule context to the bottom-right Calendar composer.

- Rebase a newer coalesced local mutation on the server revision returned for an earlier in-flight mutation from the same device. Preserve the newer local payload and mutation identity.
- Ignore repeated submits from the task and calendar-event editors after the first valid submit, preventing rapid taps from creating records with separate IDs.
- Show the selected start date's visible timed calendar events, planned work, and task deadlines in the Calendar composer. Show all-day events above the timeline. Changing the start date changes the displayed day's context.

## Acceptance and validation

- [x] A deterministic storage test verifies that an in-flight save acknowledgement rebases a newer local edit without losing its payload.
- [x] A deterministic timeline test verifies selected-day events, scheduled work, deadlines, and hidden-calendar filtering.
- [x] Web tests (33/33), typecheck, lint, Cloudflare production build, dependency audit, and branch-flow validation pass locally.
- [x] Version-branch CI (`web` and `docs`) passed, and the main-only Cloudflare deployment serves the updated Calendar composer assets.

## Manual validation

On the installed iPhone and iPad apps, create and edit tasks on each device, confirm the other device receives the changes, and try rapid repeated submits to confirm a single task or event is created. In the Calendar composer, inspect a day containing timed events, all-day events, planned work, and a deadline; change the start date and confirm the timeline updates to that day.

## Audit classification

**Completed / Passed:** implementation, all listed local automated checks, version-branch CI, main promotion, and the production asset smoke check.

**Requires Manual Validation:** cross-device behavior and mobile Calendar composer layout listed above.

**Incomplete / Needs Work:** none known. The real-device sync and iPhone/iPad layout checks above remain open for manual acceptance.
