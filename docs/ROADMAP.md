# Roadmap

## Version and branch strategy
The permanent v1/v2 checkpoints are cumulative: `v1.00` is the tasks-and-dashboard release; `v1.01`, `v1.02` and `v1.03` are phase checkpoints for v2 work; `v2.00` is the completed v2 release candidate. Development happens on temporary branches from the active checkpoint. Merge to that checkpoint after review and CI, then promote a release to `main` by pull request. Cloudflare production deploys from `main` only.

See [V1_STATUS.md](V1_STATUS.md), [V2_STATUS.md](V2_STATUS.md) and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

The v3 ecosystem work is delivered as cumulative permanent checkpoints `v2.01`, `v2.02`, and `v2.03`, one per Phase 10–12. Start each phase on a temporary implementation branch from its phase checkpoint, merge only after its acceptance criteria and CI pass, and create the next checkpoint from the completed one. After all three phases and required manual validation pass, create `v3.00` from `v2.03`. See [V3_STATUS.md](V3_STATUS.md) for the delivery gate.

## v1.00 — Tasks & Dashboard
Phases 1–6 delivered local task management, projects, recurrence, reminders, search/filters, Dashboard history and web notifications. The responsive web app is the supported iPhone/iPad/desktop client. Task data stays local to each browser.

## v2.00 — Calendar & Planning
- Phase 7 — Local first-party calendars, events, and the month grid with selected-day agenda/timeline.
- Phase 8 — Planned-work scheduling and calendar interaction.
- Phase 9 — Kanban, routines, templates, saved views and planning polish.

The deployed calendar has no Month/Week/Day/Agenda mode tabs. It uses month navigation and selected-day interaction. v2.00 implementation is on `main`; responsive web manual release validation remains listed in [V2_STATUS.md](V2_STATUS.md).

## v3.00 — Accounts, Sync & Calendar Subscriptions
- Phase 10 — Implement the Cloudflare Worker/D1 sync backend, per-account Durable Object coordination, managed OIDC boundary, and versioned synchronization protocol; define secure external iCalendar feed storage and fetching.
- Phase 11 — Implement multi-device synchronization and conflict resolution; add read-only HTTPS iCalendar (ICS) subscriptions that refresh and appear as separate calendars.
- Phase 12 — Backup/export, attachments, privacy, lifecycle and release hardening, including subscription recovery. Sharing/collaboration is explicitly deferred from the initial v3.00 release pending a membership/role model.

Phase 10 establishes the backend/auth ADR, ownership model, migrations, protocol tests and secure feed-ingestion design. Phase 11 implements offline-first device sync and read-only ICS subscriptions with separately managed calendars, visibility, recoloring, refresh, and unsubscribe controls. Subscribed events remain separate from editable LTM events and tasks. Google-account OAuth, write-back and two-way calendar synchronization are outside the initial v3 subscription scope. Web Push is not task synchronization.

Each phase file contains scope, implementation guidance, tests, acceptance criteria and an AI execution prompt.

## v3.01 — Course-outline importing

The new checkpoint inherits the released v3.00 tree. A temporary implementation branch adds local PDF/DOCX/text extraction, deterministic deadline/schedule detection, editable review, destination and time-zone selection, duplicate-safe batch creation, and temporary-source cleanup. Imported items use normal local persistence/sync; source documents are never uploaded. OCR and AI interpretation are deferred. See [V3_01_STATUS.md](V3_01_STATUS.md) for implementation and acceptance evidence.

## v3.02 — Dashboard workflow refinements

This checkpoint refines the Dashboard's task/calendar quick-add composer, task due-date ordering, date clearing, Dashboard scroll anchoring during sync, mobile calendar-event fields, and empty-state behavior. The Dashboard's Other Tasks panel contains undated tasks; the Overdue and Other Tasks panels are both hidden when empty. See [V3_02_STATUS.md](V3_02_STATUS.md) for the implementation and remaining manual checks.

## v3.03 — Sync recovery and event scheduling context

The checkpoint inherits the deployed v3.02 tree. It hardens coalesced local edits during in-flight sync, prevents repeated task/event form submission from creating separate records, and adds the selected day's existing event, planned-work, and deadline timeline to the Calendar composer. See [V3_03_STATUS.md](V3_03_STATUS.md) for acceptance and validation status.
