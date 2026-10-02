# LTM Todo App

LTM Todo is an ad-free, limitation-free personal productivity application for iPhone, iPad, and web. It combines task management with a first-party planning/calendar system rather than depending on Google Calendar or another external calendar provider. 

## Product pillars
- Fast capture with minimal friction.
- A chronological Dashboard that scrolls through days and shows scheduled work and due work together.
- Clear distinction between a task's due date and its scheduled work time.
- Offline-first interaction; synchronization must never be required to check off or edit local work.
- A first-class responsive web app for desktop, iPhone, and iPad, installable to the Home Screen.
- No advertisements or artificial limits on tasks, projects, reminders, tags, subtasks, recurrence, or calendars.
- First-party calendar and planning model.

## Roadmap
- **v1.00 — Tasks & Dashboard:** excellent task management, Inbox, chronological Dashboard, projects, recurrence, reminders, search, filters, offline local storage, notifications.
- **v2.00 — Calendar & Planning:** first-party day/week/month/agenda calendar, events, scheduling, time blocking, Kanban, routines, templates and advanced planning.
- **v3.00 — Accounts & Sync:** accounts, cross-device synchronization, conflict resolution, backup/export, attachments and optional collaboration.

See `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, and `docs/phases/` for implementation-ready specifications.
Current implementation and release blockers are tracked in `docs/V1_STATUS.md`.

## Development
All development follows `AGENTS.md`. Major branches are `main` and permanent `vX.XX` checkpoints. Implementation occurs only on temporary branches created from the intended version branch and is merged back after validation. Deployment is only from `main`.

### Run locally

- Web: `cd apps/web && npm ci && npm run dev`; validate with `npm test && npm run typecheck && npm run lint`. Use `npm run build:vinext` for the Cloudflare production build; `npm run build` runs the Next.js fallback build.
- Apple source: `apps/apple` is retained as an experimental native client, but GitHub Actions does not build or sign it. GitHub simulator builds are not installable on a physical iPhone/iPad; use the responsive web app and add it to the Home Screen.
- Swift core: `swift test` from the repository root.

The deployed web app stores tasks locally in each browser using IndexedDB. It has no account or cross-device synchronization in v1. iPhone/iPad Web Push requires a due time, Home Screen installation, and device permission.
