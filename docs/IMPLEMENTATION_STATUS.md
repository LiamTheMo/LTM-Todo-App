# Current Web App Implementation

Last audited: 2026-10-06. This document describes the current v3.02 tree; Dashboard implementation and validation status are tracked in [V3_02_STATUS.md](V3_02_STATUS.md). The v3.01 importer history is in [V3_01_STATUS.md](V3_01_STATUS.md). Historical phase plans are targets, not independent evidence that every manual acceptance check has passed.

## Supported client and storage

- Responsive web app for desktop, iPhone, and iPad, including Home Screen installation where supported. Native Apple source/workflows are not maintained.
- Local IndexedDB stores interactive task, project, calendar, event, block, reminder, template, routine, and saved-view data. Accounts and cross-device sync are implemented and normal production sign-in/sync were confirmed working on 2026-10-05.
- Signed-in sync uses Cloudflare D1 and per-account Durable Objects, with offline queues, revisions, dependency ordering, tombstones, retry diagnostics, and explicit conflict decisions.
- Notifications use a separate per-install Web Push queue; push delivery does not synchronize task data.

## Workspace behavior

- Dashboard opens at Today, shows due tasks and planned work by day, keeps overdue deadlines separate, and retains Today plus the previous 30 days. Older history is pruned. Undated tasks remain available in Tasks and appear in the Dashboard's separate Other Tasks panel. Both Other Tasks and Overdue are hidden when empty.
- Tasks is a Kanban with text search; dated tasks sort by closest due date within each status, followed by undated tasks. Priorities color the completion circle. Subtasks are not maintained.
- Projects, sections, tags, ordering, archive/restore, structured recurrence, routines, and templates are implemented.
- First-party calendars support full-spectrum colors, create/edit/delete, all-day/timed events, recurrence, month navigation, selected-day agenda/timeline, and planned-work blocks. Due dates and scheduled work remain separate.
- Custom date/time fields work on mobile; task date/time fields remain side by side. The current-time marker refreshes every 15 seconds.

## Course-outline importing (v3.01)

- The header opens a local browser importer for text-based PDF, DOCX, UTF-8 TXT/Markdown, or pasted text.
- PDF extraction groups text by row and preserves page numbers; DOCX extraction reads headings, paragraphs, and table rows. Extraction and parsing have file/text/page/archive/candidate limits.
- The deterministic parser uses date syntax, assessment/schedule words, nearby titles/headings, explicit times, date ranges, and bounded weekly class patterns.
- Review edits titles, type, dates, times, destination project/calendar, time zone, and optional timed-task reminders. Invalid selected items block the batch; ambiguous dates/relative references need explicit context or correction.
- All selected items are validated before creation. Existing and within-batch duplicates are skipped. Imported entities enter normal local persistence and background sync.
- Source files are never uploaded or written to IndexedDB. Full source text and snippets are excluded from saved entities; temporary state is discarded on completion/close. Original files on the device remain intact.
- Scanned PDFs need external OCR. Unusual layouts, holiday exclusions, and course week-number assumptions require review. See [V3_01_STATUS.md](V3_01_STATUS.md).

## Accounts and ecosystem

- OIDC Authorization Code + PKCE, application-session status/revocation, device management, account ownership checks, origin/CSRF controls, rate limits, and account deletion are implemented.
- Versioned JSON backup/restore validates before replacement and excludes attachment bytes/metadata, ICS URLs, and feed event caches.
- Account-protected task attachment APIs use D1 metadata/private R2 objects and support durable offline retry, deletion compensation, and cleanup.
- Read-only HTTPS ICS subscriptions support encrypted feed URLs, bounded cache, refresh/backoff, visibility/color, cancellation/exception handling, and unsubscribe. DNS/redirect checks and pinned-address TLS transport are implemented; live transport/provider acceptance remains open.

## Delivery and verification

Development uses temporary branches from permanent version checkpoints. Local checks run before merging to the version branch, GitHub Actions runs `web` and `docs` on version pushes, and Cloudflare production deploys from `main` only after promotion.

The shared Dashboard composer adds tasks or calendar events to the selected day, and mobile event date/time fields are paired horizontally. The current v3.02 scope and remaining validation are in [V3_02_STATUS.md](V3_02_STATUS.md). Normal v3.00 account sign-in/sync is confirmed in production. Advanced supported-device, offline/conflict, backup/restore, attachment, session/deletion, cleanup, and ICS drills remain in [V3_STATUS.md](V3_STATUS.md). v3.01 importer details remain in [V3_01_STATUS.md](V3_01_STATUS.md).

## Deferred scope

OCR/AI outline extraction, external-calendar write-back, sharing/collaboration, multiple planned blocks per task, and drag-and-drop planning are not part of this release. The Calendar has no separate Week/Day/Agenda modes. Native iOS/iPadOS apps are not maintained.
