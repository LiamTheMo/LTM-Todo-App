# v1.00 Progress and Release Gate

This document tracks the implementation against Phases 1–6. The permanent `v0.xx` branches are checkpoints, not claims of phase completion. The final `v1.00` branch must be created only after the release gate below.

## Completed / Passed

- `v0.01`: runnable SwiftUI iPhone/iPad and Next.js web shells, with main-only Cloudflare deployment.
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
- Phase 3: window extension and empty-day compression need polish, and performance needs measurement with large datasets.
- Phase 4: project/section ordering, archive recovery and subtasks need full cross-client parity and destructive-action tests.
- Phase 5: recurrence lacks selected weekdays, explicit end conditions, and DST ambiguity policy. Native notification reconciliation needs device tests and rolling-horizon safeguards. Web reminders are persisted but web notification delivery is not implemented.
- Phase 6: global filters and accessibility/performance audits, integrity checks, full regression coverage and documented device results remain.

## v1.00 release gate

1. Resolve all actionable Phase 1–6 gaps in temporary branches and merge them into permanent `v0.xx` checkpoints.
2. Run the entire CI/review loop with no unresolved findings and validate the destination version branch.
3. Complete the manual iPhone/iPad checklist in Phase 6. Do not label the release complete solely from automated builds.
4. Create the permanent `v1.00` branch from the validated final `v0.xx` checkpoint, then merge `v1.00` into `main` for deployment.
