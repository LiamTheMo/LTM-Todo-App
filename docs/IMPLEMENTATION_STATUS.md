# Current Web App Implementation

Last audited: 2026-10-02 against `v2.00` and the deployed `main` release.

This file records shipped behavior. Product specs and phase documents describe intended behavior and acceptance targets; when a target is not listed below as implemented, do not treat it as shipped.

## Supported client and storage

- The supported iPhone, iPad, and desktop experience is the responsive web app at [ltm-todo-app.orangecheasy.workers.dev](https://ltm-todo-app.orangecheasy.workers.dev/), including install-to-Home-Screen on supported mobile browsers.
- Task, project, calendar, event, planned-work, reminder, template, routine, and saved-view data is stored locally in each browser's IndexedDB. There are no user accounts or task-data synchronization between browsers/devices.
- The `apps/apple` SwiftUI project is retained as experimental source. GitHub Actions does not build, sign, or distribute that app; it is not the supported phone/tablet release path.
- Web Push is a separate per-install reminder-delivery service. Cloudflare D1 stores push subscription and delivery-queue details (including reminder title and scheduled time), not the task database. Each browser reconciles its own queue from local data.

## Shipped product behavior

- Dashboard and task management include local persistence, projects/sections, tags, subtasks, recurrence, reminders, search and filters, saved views, routines, templates, bulk actions, and retained completion history.
- The first-party Calendar has local calendars, a six-week month grid with event/task previews, calendar visibility, timed/all-day events and recurring series. Calendar creation uses the in-app full-spectrum calendar color wheel with 8-bit RGB channels (0–255 each); named legacy colors migrate to their previous hex values.
- Selecting a date shows its agenda and chronological day timeline. Timed events and scheduled task blocks appear in the timeline; due dates remain separate from planned-work times.
- The calendar has no Month/Week/Day/Agenda mode switch. Month navigation and selecting a date are the available calendar navigation controls.
- Planned-work blocks can be created, edited, and removed from the task/calendar forms. Drag-and-drop scheduling and multiple blocks per task are not shipped.
- The current-time marker on today's timeline refreshes every 15 seconds. It moves with elapsed time, but is not a frame-by-frame animation.
- Task editor data selectors use in-app custom controls. Opening New Task does not focus the title field.
- Due-time captions use compact 12-hour labels, for example `Due 9:15am` and `Due 5:30pm`.

## Delivery and validation

- Permanent phase checkpoints through v2 are `v1.00`, `v1.01`, `v1.02`, `v1.03`, and `v2.00`. Work uses temporary branches, merges to the active checkpoint after review, waits for its checks, then promotes a release to `main`. Cloudflare deploys from `main` only.
- The latest recorded v2.00 CI run (#138, commit `165ff2477dff5307f60a3349a9205042b1f9bedd`) passed `web`, `swift-core`, `docs`, and the `apple` policy check. The Apple check intentionally confirms native builds are disabled; it is not an iOS build or UI test.
- The Swift job reports an upstream Node.js 20 deprecation warning from `swift-actions/setup-swift`. Its latest stable v2.4.0 and v3.0.0-beta.1 manifests both still target Node 20; changing to the beta would not clear the warning. The Swift job itself passes.

## Not shipped yet

- Cross-device task-data sync, accounts, backend authentication, sync conflict handling, and backup/export.
- Drag-and-drop scheduling, multiple work blocks per task, and separate week/day/agenda calendar modes.
- Native iOS app distribution.

See [V2_STATUS.md](V2_STATUS.md), [ROADMAP.md](ROADMAP.md), and [ARCHITECTURE.md](ARCHITECTURE.md) for release gates and future work.
