# v3.04 — Task scheduling as linked calendar events

## Change

Scheduling a task's work session now creates a normal first-party **timed calendar event** with an optional `taskId` link. Unlike legacy planned-work blocks, new sessions are stored once in `calendarEvents` and appear in the day/month calendar and Dashboard scheduled section. The task's independent due date is unchanged.

- Choose a writable calendar, date, duration and an available time slot in the task scheduler.
- The selected slot is shown as a **clearly labelled unsaved preview** in the day timeline. The timeline automatically scrolls to the preview and updates if the date, duration, calendar or slot changes.
- Creating or editing a normal calendar event in the bottom-right Calendar composer also previews a valid unsaved timed event on the selected day's timeline.
- Editing an existing legacy block converts it to a linked event and soft-deletes the legacy block.
- Editing a linked task session keeps its event identity; removing it soft-deletes the event.
- Calendar timeline, month counts, and event rows avoid displaying a linked session twice. Hidden calendars still reserve availability.
- A task title change updates matching linked event titles. Deleting a task deletes its linked events. Recurring task completion clears linked events and Undo restores them.
- `taskId` is optional on calendar-event payloads and validated by local storage and the sync protocol. Existing calendar events and existing `blocks` remain readable.

## Automated coverage

`apps/web/tests/task-calendar-scheduling.test.mjs` covers create/edit session event persistence, Dashboard/calendar representation, independent task deadline, valid/invalid links and sync payloads, task renaming, recurring completion/undo and retention cleanup. Existing calendar timeline, scheduling slots, domain, storage and sync suites remain applicable.

## Release checklist

- [ ] TypeScript typecheck, ESLint, complete web tests, production Worker build, dependency/security audit and docs/branch-flow checks pass.
- [ ] Temporary feature branch is merged to `v3.04`, and version branch CI (`web`/`docs`) passes.
- [ ] `v3.04` is promoted to `main`, Cloudflare production deploy succeeds, and production smoke checks pass.

## Manual validation

On desktop and installed iPhone/iPad PWAs: schedule a task and select several time slots; verify the preview moves to the expected hour; change duration and calendar, then save. Verify exactly one event in Calendar and one scheduled task in Dashboard, with an unchanged deadline. Edit the session, remove and Undo, and test an older legacy block; verify cross-device synchronization and recurrence/undo. Test hidden and subscribed calendars as busy time and confirm only writable calendars can be selected for task sessions.
