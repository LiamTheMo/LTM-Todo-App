# Current Web App Implementation

Last audited: 2026-10-04. The shipped-behavior section describes deployed `main`; the v3 work-in-progress section describes the current local implementation branch and is not deployed.

This file records shipped behavior. Product specs and phase documents describe intended behavior and acceptance targets; when a target is not listed below as implemented, do not treat it as shipped.

## Supported client and storage

- The supported desktop, iPhone and iPad experience is the responsive web app at [ltm-todo-app.orangecheasy.workers.dev](https://ltm-todo-app.orangecheasy.workers.dev/), including install-to-Home-Screen on supported mobile browsers.
- Task, project, calendar, event, planned-work, reminder, template, routine and saved-view data is stored locally in each browser's IndexedDB. There are no user accounts or task-data synchronization between browsers/devices.
- The repository maintains the web application only; native Apple app source and native build/test workflows have been removed.
- Web Push is a separate per-install reminder-delivery service. Cloudflare D1 stores push subscription and delivery-queue details (including reminder title and scheduled time), not the task database. Each browser reconciles its own queue from local data.

## v3 work in progress (not deployed)

- The dirty local implementation branch contains the OIDC account flow, versioned sync API, D1 account/entity/journal store serialized by a Durable Object, offline IndexedDB mutation queues, deterministic conflict choices, device/session controls, and account-scoped sync UI. It has not been committed, pushed, promoted to `main`, or validated against provisioned production Cloudflare resources.
- Versioned local JSON backup/restore and account-protected attachment APIs backed by D1 metadata and R2 objects are implemented and locally tested. Restore validates the data before replacing local state. Backups exclude attachment data and ICS feed URLs/event caches; attachments must be downloaded separately.
- ICS subscriptions are implemented locally: encrypted account-scoped URLs, conditional refresh and backoff, bounded cache, SSRF/DNS/redirect checks, pinned-address TLS transport, read-only calendar rendering, and add/show-hide/recolor/refresh/unsubscribe controls. Production Worker networking and provider behavior still require live validation.
- Session revocation, inactive-device expiry, journal/tombstone retention, account deletion, paged R2 cleanup, and orphan reconciliation are implemented and tested locally. Revoking the app's session does not revoke the user's session at the identity provider. Production recovery/deletion drills remain open.
- Optional multi-user sharing/collaboration is explicitly deferred from the initial v3.00 release; no membership/role model is implemented.

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

- Permanent phase checkpoints are `v1.00`, `v1.01`, `v1.02`, `v1.03`, `v2.00`, then v3 phase checkpoints `v2.01`, `v2.02`, and `v2.03`. Work uses temporary branches, merges to the active checkpoint after review, waits for its checks, then promotes a release to `main`. Cloudflare deploys from `main` only.
- The current version-branch CI gate runs `web` and `docs`; it audits, tests, typechecks, lints and builds the web application. It has no Swift or native Apple jobs.

## Not shipped in deployed `main`

- v3 accounts, cross-device sync, backend authentication, sync conflict handling, backup/restore, attachment handling, and external ICS subscriptions (implemented locally on the work branch, not deployed).
- Google/provider OAuth and writing changes back to external calendars are not shipped. v3 ICS feeds are read-only.
- Drag-and-drop scheduling, multiple work blocks per task, and separate week/day/agenda calendar modes.

See [V2_STATUS.md](V2_STATUS.md), [ROADMAP.md](ROADMAP.md) and [ARCHITECTURE.md](ARCHITECTURE.md) for release gates and future work.
