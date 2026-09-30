# v1.00 Progress and Release Gate

This document tracks the implementation against Phases 1–6. The permanent `v0.xx` branches are checkpoints, not claims of phase completion. The final `v1.00` branch must be created only after the release gate below.

## Completed / Passed

- `v0.01`: runnable SwiftUI iPhone/iPad and Next.js web shells.
- `v0.02`: Cloudflare deployment is triggered only by a merged same-repository `vX.XX` pull request into `main`; the `v0.02` promotion exercised the gate and deployed successfully.
- `v0.04` Dashboard checkpoint: web and Apple render a bounded 56-day window and shift by 28-day overlaps, with compact empty-day rows and semantic day/group headings. Web date bucketing indexes tasks and blocks once per query; a 5,000-task/56-day test is in CI.
- `v0.05` local-data checkpoint: legacy v1 browser snapshots fill absent collections; malformed/unsupported snapshots fail closed. IndexedDB writes compare a document generation in one transaction to detect another tab's write instead of silently overwriting it. Native write failure rolls back the in-memory change; Settings can share the saved JSON backup.
- `v0.06` organization checkpoint: archiving a project hides its tasks from active Dashboard and task views on both clients, while restoration reveals the same records. Projects and sections have persisted up/down ordering, with web boundary/group regression tests and native confirmation before section deletion or project archiving.
- `v0.07` search/filter checkpoint: master Tasks can combine title/notes search with status, project/Inbox, tag, priority and due-date scopes on both clients. Results show the active criteria. Normal project/section moves now update one sort key; only dense-key collisions rebalance a group.
- Dashboard follow-up: keep a full-height Overdue section visible above the scrollable date pane, showing unfinished task deadlines when present or “Nothing overdue” when empty. The day pane opens at Today, scrolls into future dates and through the prior six calendar days, shows retained completed activity on past dates, and keeps Add controls available on retained past days. A newly added retained past-dated task appears in both Overdue and Due on its assigned date. Due-dated completions stay on their due/occurrence dates. Past scheduled work alone is not overdue. Old task, completion, and scheduled-event history expires automatically after its date leaves the seven-day window. Removed unexplained work start/end fields from task editors; previously saved scheduled blocks remain intact until their date expires.
- Local web task state uses versioned IndexedDB transactions. Native task state uses an atomic JSON file. Both clients create, edit, complete and soft-delete tasks locally.
- Dashboard separates scheduled work from due dates. Overdue is based only on unfinished task due dates before the local current date. Web day bucketing uses a work block's stored time zone; date-only deadlines remain date strings.
- Basic task editors no longer expose generic work start/end fields. Existing ScheduledBlock data is preserved; calendar-first scheduling remains in the later Phase 8 scope.
- Web domain tests cover date boundaries, anchored monthly recurrence, completion history and past Dashboard bucketing, seven-day retention and cleanup, parent/subtask behavior, section deletion and stable reordering.
- The web app has Inbox capture, Dashboard, task editor, projects/sections/tags and search/filters. The Apple app has local capture, Dashboard, task editor, projects, tags and notification scheduling. Completion records remain available from the Dashboard date stream; there is no separate History navigation.
- GitHub CI runs only on `vX.XX` version-branch pushes and covers Swift core tests, Apple simulator build, web tests/typecheck/lint/Vinext Worker build and documentation. Temporary-branch PR validation runs locally using the same checks; branch flow is checked with `scripts/check-branch-flow.sh`. Cloudflare Workers Builds deploys from `main` only, with preview builds disabled.

## Requires Manual Validation

- Launch and navigate on an iPhone and iPad; inspect Dynamic Type, VoiceOver, pointer/keyboard, gestures, reduced motion, focus and layout.
- Add the deployed web client to an iPhone Home Screen from Safari with “Open as Web App” enabled; verify its icon, title and standalone launch.
- Test airplane mode and force-quit/relaunch with edits pending; verify no task loss.
- Verify native notification permission, delivery, edits, completion, denial and time-zone changes on a real device.
- Exercise Dashboard around local midnight and DST changes on device. Check independent pane scrolling, long scroll in both directions, past-day task creation and Overdue placement, Return to Today and edits without position loss.
- Test deployed web storage across reload, browser privacy modes and realistic task counts. Browser state is per-device and does not sync yet.

## Incomplete / Needs Work

- Phase 1: design tokens and Apple simulator smoke tests need formal coverage.
- Phase 2: browser migration and invalid-snapshot tests, optimistic-write serialization, cross-tab conflict detection and native backup export are present. Real browser multi-tab/storage failure testing, native migration/recovery tests and offline force-quit checks remain.
- Phase 3: the Dashboard opens anchored at Today with a bounded 84-day date window and a seven-calendar-day history limit (Today plus six prior days). It shifts by 28-day overlaps, keeps navigation/Overdue in place, shows recent overdue tasks in both Overdue and their original Due sections, and removes expired task/event history automatically. Scroll preservation, sticky headers, rounded card edges, and independent scrolling still need long-scroll device/browser validation. Richer locale/calendar fixtures remain.
- Phase 4: project/section ordering and archive visibility/recovery have cross-client controls, with normal moves changing only one sort key. Subtask depth and move rules, drag/keyboard/VoiceOver reordering, and broader destructive-action/restart tests still need parity and validation.
- Phase 5: `v0.03` work adds weekday and end-condition controls, date recurrence checks and serialized native notification reconciliation. Device delivery and a full notification horizon strategy remain unverified. Web reminders are persisted but web notification delivery is not implemented.
- Phase 6: combined master-list search and filters are implemented. Saved-query groundwork, accessibility/performance audits, integrity checks, bulk operations, full regression coverage and documented device results remain.

## v1.00 release gate

1. Resolve all actionable Phase 1–6 gaps in temporary branches and merge them into permanent `v0.xx` checkpoints.
2. Run the entire CI/review loop with no unresolved findings and validate the destination version branch.
3. Complete the manual iPhone/iPad checklist in Phase 6. Do not label the release complete solely from automated builds.
4. Create the permanent `v1.00` branch from the validated final `v0.xx` checkpoint, then merge `v1.00` into `main` for deployment.
