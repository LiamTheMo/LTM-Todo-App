# v3.01 — Course-outline Import & Repository Documentation

## Scope

Build from the released v3.00/main tree using `v3.01 -> feat/v3.01-course-outline-import -> v3.01 -> main`. Add a private local document importer and rewrite the root README to document current product behavior, storage/privacy, setup, validation, and deployment accurately.

## Completed / Passed

- Local PDF/DOCX/TXT/Markdown and pasted-text extraction; no source-file upload, attachment creation, source IndexedDB storage, or third-party AI calls.
- Bounded extraction, PDF worker cleanup, malformed-file checks, and DOCX XML handling without rendering arbitrary HTML or fetching external resources.
- Deterministic dates, explicit times, title/heading context, relative-reference handling, numeric-date-order controls, course week assumptions, and semester-bounded weekly class candidates.
- Editable review with source/page context, selection, project/calendar/time-zone choice, optional timed-task reminders, and invalid-entry blocking.
- Batch validation before data changes, normalized duplicate checks, local domain creation, and existing persistence/sync integration.
- Temporary source state is cleared on completion/unmount, file controls reset immediately, and original device files are untouched. Source text is not included in imported notes or account payloads.
- README and current implementation documentation describe the deployed v3 baseline and v3.01 behavior, including limitations and outstanding manual acceptance.

## Automated validation and delivery

Local validation passed: 179 Node tests, TypeScript typecheck, ESLint, Vinext production build, and the dependency audit gate. The production dependency audit found zero vulnerabilities; the existing lockfile-checked development-only exception remains documented.

A headless Chromium smoke test passed pasted-text import/save/reload, duplicate re-import, real text PDF and DOCX table extraction, empty-PDF handling, source-state cleanup after close, modal dropdown/date-picker interaction, and a 390px viewport. No browser page errors or external file uploads were observed. The same-origin PDF worker is present in the production asset output. Local frontend testing used an unsigned-in session; account API acceptance remains separate.

Version-branch CI and production promotion are pending at this commit.

## Requires Manual Validation

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
