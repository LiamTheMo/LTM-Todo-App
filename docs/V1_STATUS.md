# v1.00 Progress and Release Gate

This document tracks the implementation against Phases 1–6. The permanent `v0.xx` branches are checkpoints, not claims of phase completion. The final `v1.00` branch must be created only after the release gate below.

## Completed / Passed

- `v0.01`: runnable SwiftUI iPhone/iPad and Next.js web shells.
- `v0.02`: Cloudflare deployment is triggered only by a merged same-repository `vX.XX` pull request into `main`; the `v0.02` promotion exercised the gate and deployed successfully.
- `v0.04` Dashboard checkpoint: web and Apple render a bounded 56-day window and shift by 28-day overlaps, with compact empty-day rows and semantic day/group headings. Web date bucketing indexes tasks and blocks once per query; a 5,000-task/56-day test is in CI.
- Local web task state uses versioned IndexedDB transactions. Native task state uses an atomic JSON file. Both clients create, edit, complete and soft-delete tasks locally.
- Dashboard separates scheduled work from due dates. Web day bucketing uses a work block's stored time zone; date-only deadlines remain date strings.
- Web domain tests cover date boundaries, anchored monthly recurrence, completion history, parent/subtask behavior, section deletion and stable reordering.
- The web app has Inbox capture, Dashboard, task editor, projects/sections/tags, search, filters and completion history. The Apple app has local capture, Dashboard, task editor, projects, tags, history and notification scheduling.
- PR checks cover Swift core tests, Apple simulator build, web unit tests, typecheck, lint, Next build, documentation and branch policy. Cloudflare deploys only from `main`.

## Requires Manual Validation

- Launch and navigate on an iPhone and iPad; inspect Dynamic Type, VoiceOver, pointer/keyboard, gestures, reduced motion, focus and layout.
- Test airplane mode and force-quit/relaunch with edits pending; verify no task loss.
- Verify native notification permission, delivery, edits, completion, denial and time-zone changes on a real device.
- Exercise Dashboard around local midnight and DST changes on device. Check long scroll, Return to Today and edits without position loss.
- Test deployed web storage across reload, browser privacy modes and realistic task counts. Browser state is per-device and does not sync yet.

## Incomplete / Needs Work

- Phase 1: design tokens and Apple simulator smoke tests need formal coverage.
- Phase 2: migration, concurrent update and large-list tests need stronger coverage; native recovery/export is absent.
- Phase 3: bounded date-window navigation and compact empty days are implemented; scroll preservation and sticky headers still need long-scroll device/browser validation. Automatic near-boundary extension and richer locale/calendar fixtures remain.
- Phase 4: project/section ordering, archive recovery and subtasks need full cross-client parity and destructive-action tests.
- Phase 5: `v0.03` work adds weekday and end-condition controls, date recurrence checks and serialized native notification reconciliation. Device delivery and a full notification horizon strategy remain unverified. Web reminders are persisted but web notification delivery is not implemented.
- Phase 6: global filters and accessibility/performance audits, integrity checks, full regression coverage and documented device results remain.

## v1.00 release gate

1. Resolve all actionable Phase 1–6 gaps in temporary branches and merge them into permanent `v0.xx` checkpoints.
2. Run the entire CI/review loop with no unresolved findings and validate the destination version branch.
3. Complete the manual iPhone/iPad checklist in Phase 6. Do not label the release complete solely from automated builds.
4. Create the permanent `v1.00` branch from the validated final `v0.xx` checkpoint, then merge `v1.00` into `main` for deployment.
