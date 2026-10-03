# Current Web App Implementation

Last audited: 2026-10-03 against the deployed `main` release.

This file records shipped behavior. Product specs and phase documents describe intended behavior and acceptance targets; when a target is not listed below as implemented, do not treat it as shipped.

## Supported client and storage

- The supported desktop, iPhone and iPad experience is the responsive web app at [ltm-todo-app.orangecheasy.workers.dev](https://ltm-todo-app.orangecheasy.workers.dev/), including install-to-Home-Screen on supported mobile browsers.
- Task, project, calendar, event, planned-work, reminder, template, routine and saved-view data is stored locally in each browser's IndexedDB. There are no user accounts or task-data synchronization between browsers/devices.
- The repository maintains the web application only; native Apple app source and native build/test workflows have been removed.
- Web Push is a separate per-install reminder-delivery service. Cloudflare D1 stores push subscription and delivery-queue details (including reminder title and scheduled time), not the task database. Each browser reconciles its own queue from local data.

## Shipped product behavior

- Dashboard and task management include local persistence, projects/sections, tags, recurrence, reminders, routines and templates. Tasks is a status-based Kanban with text search; the Dashboard includes dated tasks and recent completion history, while open tasks without due dates remain in Tasks only; it retains up to 31 calendar days of history.
- The first-party Calendar has local calendars and events, including all-day/timed events, recurrence, visibility, in-app creation, and calendar rename/recolor editing. The full-spectrum color wheel supports 8-bit RGB channels (0–255 each); hue selection matches the visible spectrum.
- Selecting a date shows its agenda and chronological day timeline. Timed events and scheduled task blocks appear in the timeline; due dates remain separate from planned-work times.
- The calendar has no Month/Week/Day/Agenda mode switch. Month navigation and selecting a date are the available calendar navigation controls.
- Planned-work blocks can be created, edited and removed from task/calendar forms. Drag-and-drop scheduling and multiple blocks per task are not shipped.
- The current-time marker on today's timeline refreshes every 15 seconds. It moves with elapsed time, but is not a frame-by-frame animation.
- Task editor data selectors use in-app custom controls. Opening New Task does not focus the title field. The date picker opens to the current month and highlights today's date. Task date and time inputs stay side by side on phone layouts.
- Due-time captions use compact 12-hour labels, for example `Due 9:15am` and `Due 5:30pm`.

## Delivery and validation

- Permanent phase checkpoints through v2 are `v1.00`, `v1.01`, `v1.02`, `v1.03` and `v2.00`. Work uses temporary branches, merges to the active checkpoint after review, waits for its checks, then promotes a release to `main`. Cloudflare deploys from `main` only.
- The current version-branch CI gate runs `web` and `docs`; it audits, tests, typechecks, lints and builds the web application. It has no Swift or native Apple jobs.

## Not shipped yet

- Accounts, cross-device task-data sync, backend authentication, sync conflict handling and backup/export.
- External calendar subscriptions from ICS URLs; the current calendar supports only LTM-owned local calendars and events. OAuth connections and writing events back to providers are also not shipped.
- Drag-and-drop scheduling, multiple work blocks per task, and separate week/day/agenda calendar modes.

See [V2_STATUS.md](V2_STATUS.md), [ROADMAP.md](ROADMAP.md) and [ARCHITECTURE.md](ARCHITECTURE.md) for release gates and future work.
