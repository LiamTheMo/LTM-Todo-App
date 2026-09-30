# v1.00 Progress and Release Gate

This document tracks the implementation against Phases 1–6. The permanent `v0.xx` branches are checkpoints, not claims of phase completion. The final `v1.00` branch must be created only after the release gate below.

## Completed / Passed

- `v0.01`: runnable SwiftUI iPhone/iPad and Next.js web shells.
- `v0.02`: Cloudflare deployment is triggered only by a merged same-repository `vX.XX` pull request into `main`; the `v0.02` promotion exercised the gate and deployed successfully.
- `v0.04` Dashboard checkpoint: web and Apple render a bounded 84-day navigation window, shifting by 28-day overlaps, with compact empty-day rows and semantic day/group headings. Visible history is retained for seven calendar days (Today plus six prior days). Web date bucketing indexes tasks and blocks once per query; a 5,000-task/56-day test is in CI.
- `v0.05` local-data checkpoint: legacy v1 browser snapshots fill absent collections; malformed/unsupported snapshots fail closed. IndexedDB writes compare a document generation in one transaction to detect another tab's write instead of silently overwriting it. Native write failure rolls back the in-memory change; Settings can share the saved JSON backup.
- `v0.06` organization checkpoint: archiving a project hides its tasks from active Dashboard and task views on both clients, while restoration reveals the same records. Projects and sections have persisted up/down ordering, with web boundary/group regression tests and native confirmation before section deletion or project archiving.
- `v0.07` search/filter checkpoint: master Tasks can combine title/notes search with status, project/Inbox, tag, priority and due-date scopes on both clients. Results show the active criteria. Normal project/section moves now update one sort key; only dense-key collisions rebalance a group.
- Dashboard follow-up: keep a full-height Overdue section visible above the scrollable date pane, showing unfinished task deadlines when present or “Nothing overdue” when empty. The day pane opens at Today, scrolls into future dates and through the prior six calendar days, shows retained completed activity on past dates, and keeps Add controls available on retained past days. A newly added retained past-dated task appears in both Overdue and Due on its assigned date. Due-dated completions stay on their due/occurrence dates. Past scheduled work alone is not overdue. Old task, completion, and scheduled-event history expires automatically after its date leaves the seven-day window. Removed unexplained work start/end fields from task editors; previously saved scheduled blocks remain intact until their date expires.
- Local web task state uses versioned IndexedDB transactions. Native task state uses an atomic JSON file. Both clients create, edit, complete and soft-delete tasks locally.
- Dashboard separates scheduled work from due dates. Overdue is based only on unfinished task due dates before the local current date. Web day bucketing uses a work block's stored time zone; date-only deadlines remain date strings.
- Basic task editors no longer expose generic work start/end fields. Existing ScheduledBlock data is preserved; calendar-first scheduling remains in the later Phase 8 scope.
- Web domain tests cover date boundaries, anchored monthly recurrence, completion history and past Dashboard bucketing, seven-day retention and cleanup, parent/subtask behavior, section deletion and stable reordering.
- The web app has Inbox capture, Dashboard, task editor, projects/sections/tags and search/filters. The Apple app has local capture, Dashboard, task editor, projects, tags and notification scheduling. Completion records remain available from the Dashboard date stream; there is no separate History navigation.
- GitHub CI runs only on `vX.XX` version-branch pushes and covers Swift core tests, Apple simulator build, Apple migration/UI smoke suites, web tests/typecheck/lint/Vinext Worker build/dependency audit and documentation. Temporary-branch PR validation runs locally using the same checks; branch flow is checked with `scripts/check-branch-flow.sh`. Cloudflare Workers Builds deploys from `main` only, with preview builds disabled.

## Requires Manual Validation

- User reports all previously listed manual checks passed except notification delivery and browser multi-tab storage-failure behavior. This is recorded as user-reported validation, not independently re-run here.
- Re-test browser notification permission/delivery for the open-app reminder path; also verify denied permission and browser/tab close behavior. Closed-browser delivery needs push infrastructure and is not part of local-only v1.
- Re-test multi-tab storage conflict and storage failure after this update. The app must preserve the unsaved-backup recovery message and must not silently overwrite another tab.
- Re-test newly added saved views, bulk completion, and subtask constraints on web; verify parity for the Apple subtask constraint.
- Re-test changed Dashboard and editor UI, migration recovery, and keyboard/VoiceOver task reordering on iPhone and iPad after the new build. Earlier user-reported UI checks do not cover these code changes.
- User-reported pass list includes Home Screen icon/install, airplane/offline and relaunch, Dashboard/date behavior, accessibility/layout/navigation, and deployed web persistence, excluding the two explicit exceptions above.

## Remaining Implementation

- Phase 1: semantic design tokens exist. Automated Apple simulator launch/navigation smoke coverage is now configured; the full token/component accessibility audit remains manual.
- Phase 2: browser legacy-snapshot migration, corrupt-snapshot rejection, relationship integrity, generation conflicts and native write rollback/backup are implemented. Native legacy-file migration fixtures and unsupported/corrupt JSON rejection now have automated coverage. Real browser multi-tab/storage-failure behavior still needs manual validation.
- Phase 3: dashboard navigation is bounded to 84 days with a seven-calendar-day history limit (Today plus six prior days), overlap paging, persistent Overdue, tasks shown both in Overdue and on their due date, and automatic expiry. Scroll preservation, sticky headers, rounded card edges, independent scrolling, date transitions and past-day editing are user-reported as manually tested and passed. Richer locale/calendar fixtures remain a test enhancement.
- Phase 4: project/section ordering and archive visibility/recovery have cross-client controls. Both task save paths enforce root-plus-one-subtask depth and same-project parentage. Apple project task rows now have keyboard/VoiceOver-labeled reorder controls alongside web drag/keyboard ordering. Destructive-action/restart and device VoiceOver checks remain manual.
- Phase 5: recurrence and native notification reconciliation are implemented. Web schedules reminders with the Notification API while the app is open, for a rolling seven-day window. Closed-browser delivery needs push infrastructure and is outside local-only v1. Native and web delivery still need manual validation.
- Phase 6: combined search/filters, saved views, bulk completion, storage relationship checks, and performance regression coverage are implemented. The v0.07 CI now includes Apple migration fixtures, Apple launch/navigation smoke tests, and a high-severity npm dependency audit. Full accessibility/security audits and device retesting remain manual.
- Optimization pass: web reminder planning reuses a bounded timezone formatter cache; task-graph integrity checks use indexed lookups instead of rescanning collections. Baseline measurements for 2,000 reminders were ~251 ms before caching and ~37 ms after; 10,000 task relationship validation completes in ~14 ms locally.
- Deployment process: the main-branch ruleset is active, but its required status-check list is empty. Repository CI exposes `swift-core`, `apple`, `web`, and `docs`; the ruleset must require these checks before main merges are actually gated. The connected GitHub integration is read-only for ruleset settings, so this administrative setting remains to be updated in GitHub.

## v1.00 release gate

1. Resolve actionable in-scope Phase 1–6 implementation gaps in temporary branches and merge them into permanent `v0.xx` checkpoints. Manual/device checks and administrator-only GitHub ruleset changes remain explicitly gated.
2. Run the entire CI/review loop with no unresolved findings and validate the destination version branch.
3. Complete the manual iPhone/iPad checklist in Phase 6. Do not label the release complete solely from automated builds.
4. Create the permanent `v1.00` branch from the validated final `v0.xx` checkpoint, then merge `v1.00` into `main` for deployment.

## User-reported manual validation (2026-09-30)

All earlier manual checks were reported as passed except notification delivery and browser multi-tab storage-failure behavior. Changes made in this release-hardening pass are not covered by those earlier checks; the targeted re-tests above remain required before declaring v1.00 complete.
