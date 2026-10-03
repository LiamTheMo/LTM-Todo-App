# Roadmap

## Version and branch strategy

The permanent v1/v2 checkpoints are cumulative: `v1.00` is the tasks-and-dashboard release; `v1.01`, `v1.02`, and `v1.03` are the phase checkpoints for v2 work; `v2.00` is the completed v2 release candidate. Development happens on temporary branches from the active checkpoint. Merge to that checkpoint after review and CI, then promote a release to `main` by pull request. Cloudflare production deploys from `main` only.

See [V1_STATUS.md](V1_STATUS.md), [V2_STATUS.md](V2_STATUS.md), and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## v1.00 — Tasks & Dashboard

Phases 1–6 delivered local task management, projects, recurrence, reminders, search/filters, Dashboard history, and web notifications. The responsive web app is the supported iPhone/iPad/desktop client. Task data stays local to each browser; the experimental Apple source is not built or distributed by CI.

## v2.00 — Calendar & Planning

- Phase 7 — Local first-party calendars, events, and the month grid with selected-day agenda/timeline.
- Phase 8 — Planned-work scheduling and calendar interaction.
- Phase 9 — Kanban, routines, templates, saved views, and planning polish.

The deployed calendar has no Month/Week/Day/Agenda mode tabs. It uses month navigation and selected-day interaction. v2.00 implementation is on `main`; responsive web manual release validation remains listed in [V2_STATUS.md](V2_STATUS.md).

## v3.00 — Accounts, Sync & Calendar Subscriptions

- Phase 10 — Choose backend/authentication, define the synchronization protocol, and design secure external iCalendar feed storage and fetching.
- Phase 11 — Implement multi-device synchronization and conflict resolution; add read-only HTTPS iCalendar (ICS) subscriptions that refresh and appear as separate calendars.
- Phase 12 — Backup/export, attachments, optional sharing/collaboration, and release hardening, including subscription privacy and recovery checks.

Cross-device task sync starts after the v2.00 release gate is complete. Begin with Phase 10's threat model, backend/auth ADR, data ownership, migrations, protocol tests, and a secure feed-ingestion design. Phase 11 implements offline-first device sync and read-only ICS subscriptions after the contract is tested. Subscribed events remain separate from editable LTM events and tasks. Google-account OAuth, write-back, and two-way calendar synchronization are outside the initial v3 subscription scope. Web Push is not task synchronization.
