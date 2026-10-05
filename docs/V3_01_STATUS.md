# v3.01 — Course-outline Import & Task Controls

## Scope

Add a private local course-outline importer and detailed repository documentation, then refine assignment title extraction, task priorities, and repeat controls before promoting v3.01 to production.

## Completed / Passed

- Local PDF/DOCX/TXT/Markdown and pasted-text extraction; no source-file upload, attachment creation, source IndexedDB storage, or third-party AI calls.
- Bounded extraction, PDF worker cleanup, malformed-file checks, and DOCX XML handling without rendering arbitrary HTML or fetching external resources.
- Deterministic dates, explicit times, title/heading context, relative-reference handling, numeric-date-order controls, course week assumptions, and semester-bounded weekly class candidates.
- Assignment titles prefer explicit name/title/topic/prompt fields and meaningful nearby assignment headings; generic course section headings and due-date labels are not used as task names.
- Editable review with source/page context, selection, project/calendar/time-zone choice, optional timed-task reminders, and invalid-entry blocking.
- Batch validation before data changes, normalized duplicate checks, local domain creation, and existing persistence/sync integration.
- Temporary source state is cleared on completion/unmount, file controls reset immediately, and original device files are untouched. Source text is not included in imported notes or account payloads.
- The No Priority choice is removed. New and legacy-unprioritized tasks use Low; the completion marker is lime green for Low, yellow for Medium, and red for High. Older sync clients may still send the legacy value, which local storage migrates to Low.
- Task, calendar-event, and routine repeat controls use named presets for daily, every other day, weekdays, weekends, weekly, biweekly, monthly, every two months, quarterly, and yearly schedules. Weekly/biweekly schedules retain weekday selection, and saved custom intervals remain editable.
- README and current implementation documentation describe the deployed v3 baseline and v3.01 behavior, including limitations and outstanding manual acceptance.

## Automated validation and delivery

The outline importer’s initial validation passed 179 Node tests on Node 22.23.3 and Node 24, TypeScript typecheck, ESLint, Vinext production build, and the dependency audit gate. Its headless Chromium smoke test passed pasted-text import/save/reload, duplicate re-import, real text PDF and DOCX table extraction, empty-PDF handling, source-state cleanup after close, modal dropdown/date-picker interaction, midnight time-picker selection, and a 390px viewport. No browser page errors or external file uploads were observed. The same-origin PDF worker is present in the production asset output. Local frontend testing used a signed-out session; account API acceptance remains separate.

Final task-title, priority, and repeat-preset changes passed 186 Node tests, TypeScript typecheck, ESLint, Vinext production build, and the dependency audit. The production dependency audit found zero vulnerabilities; the existing lockfile-checked development-only exception remains documented. Wrangler emitted a non-fatal read-only log-file warning in the sandbox during the otherwise successful build.

The `web` and `docs` GitHub checks passed on v3.01 merge commit `abcaa9197b3a25e5bddcaceca210bb172f9a48c0` ([workflow run](https://github.com/OrangeCheasy/LTM-Todo-App/actions/runs/37385492151)). PR [#178](https://github.com/OrangeCheasy/LTM-Todo-App/pull/178) merged the implementation into v3.01. PR [#179](https://github.com/OrangeCheasy/LTM-Todo-App/pull/179) promoted v3.01 to `main` as merge commit `0667f8012d40cd999308524efb59da95cb9f3082` on 2026-10-05.

## Requires Manual Validation

- Confirm Cloudflare Workers Builds deployed the `main` merge and smoke-test the live app at [ltm-todo-app.orangecheasy.workers.dev](https://ltm-todo-app.orangecheasy.workers.dev/). The connected page checker could not reach this URL, and Cloudflare build status is not exposed in this workspace, so deployment completion remains unconfirmed.
- Import representative real course PDFs/DOCX files on desktop, iPhone, and iPad; verify table/column grouping, titles, dates, page context, times, and corrections.
- Confirm the modal, dropdowns, custom date/time fields, keyboard focus/escape behavior, scrolling, and close cleanup on supported mobile browsers/Home Screen installs.
- Test a signed-in import syncing to a second device, plus offline import followed by reconnect.
- Import the same outline again and verify duplicate skips; make sure target projects/calendars and reminders are correct.
- Verify ambiguous numeric dates, missing years, relative dates, course week numbering, recurring-class semester bounds, overnight events, and DST dates against the actual syllabus.
- Confirm timed task notifications separately; calendar events do not gain event-specific push reminders.

## Incomplete / Needs Work

OCR for scanned documents and AI inference are deferred. The parser does not guarantee every layout, abbreviated date range, or phrase. Holidays/class exceptions require review or later event editing. Unresolved dates, missing event durations, and retention-ineligible dates must be corrected or deselected. Existing v3.00 advanced account/attachment/ICS acceptance gates remain in [V3_STATUS.md](V3_STATUS.md).

## Privacy and limits

Files: 10 MiB; PDF: 100 pages with bounded fragments/rows; DOCX: 2 MiB document XML and 2,000 archive entries; extracted/pasted text: 500,000 characters; review/import: 250 items. Lazy-loaded PDF.js and fflate support extraction; a version-matched same-origin PDF worker is generated during `npm ci`. Full source documents/snippets stay temporary in browser memory and do not enter saved records, backups, or server logs.
