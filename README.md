# LTM Todo App

LTM Todo is an ad-free, limitation-free personal productivity application for iPhone, iPad, and web. It combines task management with a first-party planning/calendar system rather than depending on Google Calendar or another external calendar provider.

## Product pillars
- Fast capture with minimal friction.
- A chronological Dashboard that scrolls through days and shows scheduled work and due work together.
- Clear distinction between a task's due date and its scheduled work time.
- Offline-first interaction; synchronization must never be required to check off or edit local work.
- Native-quality iPhone/iPad experience plus a first-class web client.
- No advertisements or artificial limits on tasks, projects, reminders, tags, subtasks, recurrence, or calendars.
- First-party calendar and planning model.

## Roadmap
- **v1.00 — Tasks & Dashboard:** excellent task management, Inbox, chronological Dashboard, projects, recurrence, reminders, search, filters, offline local storage, notifications.
- **v2.00 — Calendar & Planning:** first-party day/week/month/agenda calendar, events, scheduling, time blocking, Kanban, routines, templates and advanced planning.
- **v3.00 — Accounts & Sync:** accounts, cross-device synchronization, conflict resolution, backup/export, attachments and optional collaboration.

See `docs/ROADMAP.md`, `docs/ARCHITECTURE.md`, and `docs/phases/` for implementation-ready specifications.

## Development
All development follows `AGENTS.md`. Major branches are `main` and permanent `vX.XX` checkpoints. Implementation occurs only on temporary branches created from the intended version branch and is merged back after validation. Deployment is only from `main`.
