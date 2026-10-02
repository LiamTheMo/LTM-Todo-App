# LTM Todo App

LTM Todo is an ad-free personal productivity web app with a first-party task and calendar model. The supported experience works in desktop browsers and on iPhone/iPad, where it can be added to the Home Screen. It does not depend on Google Calendar.

## Product pillars

- Fast capture and a chronological Dashboard for scheduled work and due tasks.
- Due dates stay separate from planned-work blocks.
- Offline-first local data; common task and calendar changes work without a server.
- A responsive, installable web app with local browser storage.
- No ads or artificial limits on tasks, projects, reminders, tags, subtasks, recurrence, or calendars.
- First-party calendars and events, with custom full-spectrum RGB calendar colors.

## Current implementation

See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md) for the audited feature list, limitations, storage and delivery status.

## Roadmap

- **v1.00 — Tasks & Dashboard:** local task management, projects, recurrence, reminders, search, filters, offline storage and notifications.
- **v2.00 — Calendar & Planning:** first-party calendars and events, a month grid with day timeline, planned-work blocks, Kanban, routines, templates and planning polish.
- **v3.00 — Accounts & Sync:** accounts, cross-device task-data synchronization, conflict handling, backup/export and later ecosystem features.

The calendar offers month navigation and a selected-day timeline; it does not have separate Month/Week/Day/Agenda mode tabs. See [docs/ROADMAP.md](docs/ROADMAP.md) and [docs/V2_STATUS.md](docs/V2_STATUS.md).

## Development

Follow [AGENTS.md](AGENTS.md). Permanent checkpoints are `main` and `vX.XX` version branches. Develop on temporary branches from the intended checkpoint, merge after validation, and deploy only from `main`.

- Web: `cd apps/web && npm ci && npm run dev`; checks: `npm test && npm run typecheck && npm run lint`. Use `npm run build:vinext` for the Cloudflare production build; `npm run build` is the Next.js fallback build.
- Swift core: `swift test` from the repository root.
- `apps/apple` remains experimental source. GitHub Actions does not build, sign, or distribute it; use the responsive web app on iPhone/iPad.

The deployed app stores user task data locally in each browser's IndexedDB. It has no accounts or cross-device task synchronization yet. Web Push reminders use a separate per-browser queue in Cloudflare D1 and do not sync task data.