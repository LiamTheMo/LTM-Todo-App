# LTM Todo

**An offline-first task manager and personal calendar for desktop, iPhone, and iPad, with account sync and private course-outline importing.**

LTM Todo brings deadlines, planned work, and calendar events into one chronological workspace. It is a responsive TypeScript/React web app that can be installed to a supported device's Home Screen. The app owns its task and calendar system; Google Calendar is not a required dependency.

[Open the app](https://ltm-todo-app.orangecheasy.workers.dev/) · [Implementation status](docs/IMPLEMENTATION_STATUS.md) · [v3.02 status](docs/V3_02_STATUS.md) · [Engineering contract](AGENTS.md)

## Contents

- [What the app does](#what-the-app-does)
- [Course-outline imports](#course-outline-imports)
- [Storage, privacy, and synchronization](#storage-privacy-and-synchronization)
- [Install and use](#install-and-use)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Quality checks](#quality-checks)
- [Cloudflare setup and deployment](#cloudflare-setup-and-deployment)
- [Versions and contribution workflow](#versions-and-contribution-workflow)
- [Limitations and validation](#limitations-and-validation)
- [Further documentation](#further-documentation)

## What the app does

### Dashboard

The Dashboard opens at Today and groups scheduled work and due tasks by calendar date. Scroll forward to upcoming days or backward through recent history. The Overdue panel keeps missed deadlines separate, while undated tasks appear in an Other Tasks panel. Both panels stay hidden when they have no items.

The history window includes Today and the preceding 30 calendar days. Older task, completion, and scheduled-event history is automatically pruned. Imported dates obey the same policy. Future deadlines are not restricted to this 31-day window.

### Tasks and projects

- Create and edit tasks with titles, notes, optional dates/times, priorities, tags, and project organization. New tasks default to Low; older unprioritized tasks load as Low.
- Use the Tasks Kanban and text search to see active and completed work.
- Keep due dates separate from scheduled work blocks.
- Set repeat presets for daily, every other day, weekdays, weekends, weekly, biweekly, monthly, every two months, quarterly, or yearly schedules. Weekly and biweekly repeats can target specific weekdays; use an end date or occurrence count to limit a series. Add timed reminders, and use routines and templates for repeated work.
- Organize work into projects and sections, adjust ordering, and archive or restore projects.
- See priority through the completion circle: lime green for Low, yellow for Medium, and red for High.

### Calendar and planning

Create first-party calendars with full-spectrum colors, then add all-day or timed events and recurrence. The month grid opens a selected-day agenda and timeline. Due tasks, calendar events, and planned task blocks remain distinct entities.

Calendar names and colors can be edited, and calendars/events can be deleted through the app. The timeline includes a current-time indicator. Calendar navigation uses a month grid and day selection rather than separate Month/Week/Day/Agenda tabs.

### Accounts and portability

Sign in to synchronize supported task and calendar data across browser profiles and installed web-app instances. Local editing stays available offline. Settings shows account status, sync progress, retry diagnostics, conflict choices, and device/session controls.

Download a versioned JSON backup or restore a validated backup. Private task attachments have separate account-protected upload/download/delete controls. Optional HTTPS iCalendar subscriptions appear as read-only calendars; live provider and Worker transport acceptance checks remain documented separately.

## Course-outline imports

**Choose a file or paste text → find items → review/edit → import selected items → discard temporary document data.**

Use **Import outline** in the page header. This opens an importer that processes documents on the device. It never sends the source file to the server, an AI provider, the attachment service, or account sync.

### Inputs and limits

| Input | Extraction | Limits |
| --- | --- | --- |
| Text-based PDF | PDF.js reads text and page coordinates; nearby text on a row is grouped, and larger text can supply heading context | 10 MiB, 100 pages, bounded page fragments |
| DOCX | Extracts the document XML, paragraph/heading text, and table rows; embedded images and external resources are not fetched | 10 MiB archive; bounded XML and archive entries |
| TXT / Markdown | Reads UTF-8 lines; Markdown headings can supply section context | 10 MiB file |
| Pasted text | Parses lines directly | 500,000 characters |

All extracted text is limited to 500,000 characters, and one review contains at most 250 candidates. Scanned/image-only PDFs require OCR outside this importer; paste recognized text or use a text-based document. Legacy `.doc`, images, and arbitrary web URLs are not accepted.

### How detection works

The deterministic parser considers assessment/schedule keywords, headings, adjacent titles, and rows containing dates. It looks for assignment/essay/project deadlines, exams and presentations, class schedules, breaks, and other dated course items.

| Example | Suggested item |
| --- | --- |
| `Assignment 2 — due October 20 at 11:59 PM` | Task with a date and time |
| `Essay — due 22 November 2026` | Date-only task |
| `Midterm — October 21, 2:30–3:50 PM` | Timed calendar event |
| `Holiday break October 12 to October 16` | All-day event spanning those dates |
| `Lectures every Monday and Wednesday 2:30–3:50 PM` | Weekly calendar event when semester start/end are supplied |

Explicit years are preserved. Missing years use the selected semester year and receive a review note. Ambiguous numeric dates remain unresolved unless you choose Month/Day or Day/Month. Relative dates such as “tomorrow” need a document reference date. Week-number dates require semester start and a weekday, and their Monday-based numbering assumption is shown for review.

Weekly class imports begin on the next matching date at or after Today within the supplied semester. They stop at semester end; holidays and exceptions must be checked separately. The parser does not invent an event duration, infer a missing deadline time, or guarantee interpretation of every course-outline layout.

### Review and save

- Check the title, task/event type, date, optional times, and any recurrence.
- Read the original extracted source snippet and parsing notes; PDF candidates include page numbers.
- Choose an existing active project for tasks and an editable first-party calendar for events.
- Set an IANA time zone, such as `America/Edmonton`, and optional reminders for tasks with a due time.
- Deselect irrelevant entries or fix invalid entries before importing.
- Repeated entries are skipped by normalized title, destination, dates/times, and event recurrence. This includes duplicates within the same batch.

The complete selected batch is validated before it changes data. Imported entities use the same local storage, revision metadata, reminders, and background sync paths as manually created items. Full source documents and extraction snippets are not saved in task/event notes. Closing/cancelling discards temporary importer state, and successful import clears it immediately. The original file on the device is not deleted.

## Storage, privacy, and synchronization

| Data | Storage and behavior |
| --- | --- |
| Tasks, projects, calendars, events, blocks, reminders, templates, routines | Local IndexedDB for interaction; signed-in account sync uses Cloudflare D1 and a per-account Durable Object |
| Offline changes | Queued locally and retried after reconnecting; conflicting edits require an explicit choice |
| Account sessions | OIDC Authorization Code + PKCE flow with application session controls |
| Task attachment bytes | Private R2 objects, with ownership-checked metadata/API access and offline upload retry queues |
| Web Push subscriptions and delivery queue | Separate notifications D1 database; push delivery is distinct from task sync |
| ICS feed URLs | Account-scoped encrypted storage; read-only event caches are separate from editable events |
| Outline source files/text | Temporary browser memory only; not uploaded, cached by the importer, or exported |
| JSON backups | Validated local domain data; excludes attachments, ICS URLs, and cached feed events |

Account traffic is encrypted in transit. This is not a claim of end-to-end encryption for task data. Feed URLs use a dedicated encryption key because they can act as bearer credentials. Logs and sync diagnostics use allowlisted categories rather than source documents, tokens, or user-content dumps.

Back up important local data before clearing browser storage or performing a restore. Browser-profile data and server account data have different lifecycles; deleting an account does not automatically erase an existing local offline profile.

## Install and use

1. Open the app in a supported browser.
2. On iPhone/iPad, use the browser's **Add to Home Screen** flow where available. On desktop, use the browser's install option where supported.
3. Sign in from Settings for cross-device sync, or continue with local data.
4. Create calendars/projects, add tasks/events, or use **Import outline**.
5. Configure notifications on each installation if you want Web Push reminders.

The maintained client is an installable web app. This repository does not ship a native iOS/iPadOS application or require a Mac/Xcode development environment. Notification permission, Home Screen installation requirements, and background delivery depend on the browser/platform.

## Architecture

The frontend uses React 19 and TypeScript with Next.js conventions. Vinext/Vite provides the Cloudflare production build. Framework-independent modules implement domain behavior, recurrence, date semantics, backup validation, document parsing, and synchronization contracts.

Local persistence is authoritative for interactive behavior. Entity UUIDs, created/updated timestamps, revisions, tombstones, and mutation queues support asynchronous synchronization. D1 stores synchronized entities and journals. A Durable Object serializes each account's sync operations. R2 holds private attachment bytes. A Worker cron processes reminder delivery, retention, feed refresh, and cleanup work.

Outline extraction and interpretation are separate modules. PDF.js and fflate are loaded when a document needs them. The version-matched PDF worker is copied into public assets during dependency installation and served from the app's own origin. No paid AI extraction service is required.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `apps/web/app/` | App routes, main workspace, global styles, and API route adapters |
| `apps/web/components/` | Reusable controls, timeline/color components, and outline-import review UI |
| `apps/web/lib/` | Domain, calendar, storage, sync, auth, attachments, ICS, backups, and outline extraction/import modules |
| `apps/web/tests/` | Node tests for domain behavior, integrations, security boundaries, and failure paths |
| `apps/web/scripts/` | Deployment guard, dependency audit policy, and PDF worker asset preparation |
| `apps/web/migrations/` | Notifications D1 migrations |
| `apps/web/sync-migrations/` | Account/sync D1 migrations |
| `apps/web/worker.ts` | Cloudflare Worker entry and scheduled work |
| `apps/web/wrangler.jsonc` | Resource bindings and non-secret deployment configuration |
| `services/sync/README.md` | Backend provisioning and identity configuration |
| `shared/schemas/`, `shared/fixtures/` | Versioned sync contract and deterministic fixtures |
| `docs/` | Product, architecture, data model, decisions, phase contracts, and release status |
| `scripts/check-branch-flow.sh` | Validates allowed pull-request branch flow |

## Local development

Use Node.js 22.13+ (or a compatible current Node release) and npm. CI uses Node 22. Run commands from `apps/web`:

```bash
cd apps/web
npm ci
npm run dev
```

`npm ci` runs the PDF-worker asset preparation script. The normal development server supports frontend/local-storage work without production account credentials. Use `npm run dev:vinext` for the Cloudflare/Vinext development path. Account APIs require configured local Worker resources and OIDC settings; an unconfigured local environment does not imply a production authentication failure.

```bash
npm run migrate:local
npm run dev:vinext
```

For local Worker secrets, use Wrangler's local environment mechanism and keep secret files out of Git. Follow [the sync setup guide](services/sync/README.md) and [ADR 0003](docs/adr/0003-v3-sync-backend.md) for resource and authentication details. D1 IDs in checked-in config are placeholders, not production resource identifiers.

## Quality checks

```bash
cd apps/web
npm test
npm run typecheck
npm run lint
node scripts/audit-dependencies.mjs
npm run build:vinext
```

The test suite covers date-only/time-zone semantics, recurrence/DST, retention, sync ownership and conflict behavior, IndexedDB queues, migrations, attachment/feed boundaries, and outline-import validation and duplicate handling. Source extraction also needs browser acceptance checks for representative PDF/DOCX layouts.

`npm run build` is the Next.js fallback build. `npm run build:vinext` is the production Worker build. High/critical production dependency findings fail validation. The full-tree audit permits only the existing narrowly checked development-only advisory documented in [engineering workflows](docs/WORKFLOWS.md).

## Cloudflare setup and deployment

Production uses Cloudflare Workers Builds linked to the repository, with production branch **main** and preview builds disabled. GitHub Actions performs version-branch CI and does not deploy.

| Setting | Value |
| --- | --- |
| Worker | `ltm-todo-app` |
| App directory | `apps/web` |
| Dependency installation | `npm ci` |
| Build command | `npm run build:vinext` |
| Deploy command | `npm run deploy:worker` |
| Notifications D1 | `ltm-todo-notifications` / binding `DB` |
| Sync D1 | `ltm-todo-sync` / binding `SYNC_DB` |
| Durable Object | `AccountSyncCoordinator` / binding `SYNC_COORDINATOR` |
| Private R2 | `ltm-todo-attachments` / binding `ATTACHMENTS_BUCKET` |

Build variables include `D1_DATABASE_ID` and `SYNC_D1_DATABASE_ID`. Build secrets include the VAPID private key, OIDC issuer/audience/JWKS/client/callback configuration, independent session/cursor/feed-encryption keys, and an OIDC client secret when the provider requires one. See the setup guide for the exact names and formats. Never commit these values.

The deploy script checks Cloudflare's build context and rejects any branch other than `main`. It validates configuration, injects resource IDs/secrets into temporary configs, applies both D1 migration sets, deploys, and cleans up temporary secret/config files. Deployments reach `main` through version-branch pull requests after version CI passes.

## Versions and contribution workflow

| Version | Scope |
| --- | --- |
| `v1.00` | Tasks, projects, Dashboard, local persistence, recurrence, and reminders |
| `v2.00` | First-party calendar, planning, Kanban, routines, and templates |
| `v3.00` | Accounts, cross-device sync, backups, protected attachments, and optional read-only ICS subscriptions |
| `v3.01` | Course-outline import and updated repository/product documentation |
| `v3.02` | Dashboard quick-add and scheduling refinements, task due-date ordering, undated-task panel, and mobile form polish |
| `v3.03` | Cross-device sync recovery and selected-day event timeline in the Calendar composer |

All `vX.XX` branches are permanent historical checkpoints. Development happens on a descriptive temporary branch created from the intended version:

```text
v3.02 → chore/your-change → v3.02 → main → Cloudflare deployment
```

Before changing anything, audit repository state and read `AGENTS.md`. Run the audit/implement/validate/review loop, resolve actionable findings, and validate branch flow. Merge the temporary branch into its originating version, wait for version CI, then promote that version to `main`. Never develop directly on major branches, deploy a temporary/version branch, delete version checkpoints, or rewrite their history without explicit authorization.

## Limitations and validation

The repository documents implementation and manual acceptance separately. Normal production sign-in and cross-device sync were confirmed working on October 5, 2026. Advanced offline/conflict, lifecycle, attachment cleanup, and live ICS transport checks remain listed in [v3 status](docs/V3_STATUS.md).

Outline importing is rule-based and intentionally reviewable. Multi-column PDFs, split table layouts, footnotes, unusual date formats, holidays, and inconsistent week numbering can require correction. OCR, AI inference, external-calendar write-back, multi-user collaboration, drag-and-drop planning, multiple work blocks per task, and native Apple apps are outside this release.

Imported calendar events do not create event-specific push reminders; the importer offers reminders for timed task deadlines. Local parsing does not need sign-in, but cross-device propagation does. A browser/device matrix and real course-outline imports remain manual acceptance checks.

## Further documentation

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Data model](docs/DATA_MODEL.md)
- [Dashboard behavior](docs/DASHBOARD_UX.md)
- [Roadmap](docs/ROADMAP.md)
- [Engineering workflows](docs/WORKFLOWS.md)
- [Phase contracts](docs/phases/)
- [Backend setup](services/sync/README.md)
- [Current implementation](docs/IMPLEMENTATION_STATUS.md)
- [v3.00 delivery and manual acceptance](docs/V3_STATUS.md)
- [v3.01 outline import](docs/V3_01_STATUS.md)
- [v3.02 Dashboard status](docs/V3_02_STATUS.md)
- [v3.03 sync and Calendar composer](docs/V3_03_STATUS.md)
