# v3.04 — Task scheduling as linked calendar events

## Change

Scheduling a task's work session now creates a normal first-party **timed calendar event** with an optional `taskId` link. Unlike legacy planned-work blocks, new sessions are stored once in `calendarEvents` and appear in the day/month calendar and Dashboard scheduled section. The task's independent due date is unchanged.

- Choose a writable calendar, date, duration and an available time slot in the task scheduler.
- The selected slot is shown as a **clearly labelled unsaved preview** in the day timeline. The timeline automatically scrolls to the preview and updates if the date, duration, calendar or slot changes.
- Creating or editing a normal calendar event in the bottom-right Calendar composer also previews a valid unsaved timed event on the selected day's timeline.
- Editing an existing legacy block converts it to a linked event and soft-deletes the legacy block.
- Editing a linked task session keeps its event identity; removing it soft-deletes the event.
- Calendar timeline, month counts, and event rows avoid displaying a linked session twice. Hidden calendars still reserve availability.
- A task title change updates matching linked event titles. Deleting a task deletes its linked events. Completing any task cancels its future calendar reservations; recurring completion also clears work sessions from the completed occurrence. Undo restores cleared sessions. Past completed sessions remain visible.
- Linked task sessions older than the 31-day Dashboard history window are pruned even if the parent task has no due date. Standalone calendar events retain their normal history.
- `taskId` is optional on calendar-event payloads and validated by local storage and the sync protocol. Existing calendar events and existing `blocks` remain readable.

## Automated coverage

`apps/web/tests/task-calendar-scheduling.test.mjs` covers create/edit session event persistence, Dashboard/calendar representation, independent task deadline, valid/invalid links and sync payloads, task renaming, recurring completion/undo and retention cleanup. Existing calendar timeline, scheduling slots, domain, storage and sync suites remain applicable.

## Release checklist

- [ ] TypeScript typecheck, ESLint, complete web tests, production Worker build, dependency/security audit and docs/branch-flow checks pass.
- [ ] Temporary feature branch is merged to `v3.04`, and version branch CI (`web`/`docs`) passes.
- [ ] `v3.04` is promoted to `main`, Cloudflare production deploy succeeds, and production smoke checks pass.

## Manual validation

On desktop and installed iPhone/iPad PWAs: schedule a task and select several time slots; verify the preview moves to the expected hour; change duration and calendar, then save. Verify exactly one event in Calendar and one scheduled task in Dashboard, with an unchanged deadline. Edit the session, remove and Undo, and test an older legacy block; verify cross-device synchronization and recurrence/undo. Test hidden and subscribed calendars as busy time and confirm only writable calendars can be selected for task sessions.

## Auth session refresh

Browser sign-in now requests `offline_access` and keeps the provider refresh token in the encrypted session cookie, so sessions renew automatically instead of signing out when the access token expires. See [Staying signed in](CLOUDFLARE_DEPLOYMENT.md#staying-signed-in-refresh-tokens) for behavior and the required Auth0 settings. `apps/web/tests/oidc-session.test.mjs`, `account-lifecycle.test.mjs`, and `auth-sign-in-status.test.mjs` cover refresh, rotation, transient failure, rejection, revocation, logout, and cross-tab serialization.

Manual validation: after enabling Auth0 offline access and the refresh-token grant, sign in on desktop and an installed iPhone/iPad PWA; confirm the session survives past the Auth0 access-token lifetime (or a temporarily shortened API token expiration), that Settings → Sessions shows a rolling expiry, and that revoking a session or signing out prevents further refreshes.

## Automatic sync conflicts

Sync no longer needs manual action in Settings. When two devices change the same record, the next sync settles it automatically (`apps/web/lib/sync-conflict-policy.ts`):

- Two edits: the most recent edit (by its `updatedAt`) wins. Ties keep the server copy so every device converges.
- An edit always beats a deletion, whichever came first, so no device's work is discarded; the record stays. Deletions on both sides need nothing pushed.
- A conflict whose server copy cannot be applied yet (for example, a referenced record has not arrived) stays recorded and is retried on the next sync; only then does Settings list it.
- A held conflict no longer blocks other queued changes from uploading.
- Local edits made while a sync is applying remote changes are replayed on top of them instead of failing with "changed in another tab" or briefly disappearing (`apps/web/lib/local-edit-queue.ts`).
- While the app is visible it syncs every 15 seconds, as well as after each change, when it becomes visible and when the device reconnects. The **Sync now** button is removed.

`tests/multi-device-sync.test.mjs` runs two devices with separate local databases against the real sync server code: a task created on one appears on the other, completions replicate back, offline creations on both merge without duplicates, concurrent edits converge on the newest edit without blocking a new task, and an offline edit survives a remote deletion. `tests/sync-conflict-policy.test.mjs`, `tests/local-edit-queue.test.mjs`, `tests/sync-storage.test.mjs` and `tests/sync-client.test.mjs` cover the policy, edit replay, automatic resolution, rebased re-push and non-blocking conflicts.

Manual validation: on two signed-in devices, edit the same task offline on both and reconnect; edit on one while deleting on the other; confirm both converge within about 15 seconds without a Settings prompt and that editing during an incoming sync keeps the edit.

## Completions made on two devices

Completing a task on two devices before they sync (for example, while one was signed out) used to create two completion records, so the task appeared twice under COMPLETED; deleting it removed both rows because both belonged to the same task. Completion IDs are now derived from the task and its occurrence date (`completionIdFor` in `apps/web/lib/domain.ts`, a version-8 UUID), so both devices create the same record and sync merges it. Existing duplicates show once (the latest copy, which Undo acts on), and Undo removes every copy of that occurrence. Recurring occurrences keep separate history. Covered by `tests/completion-identity.test.mjs` and the double-completion case in `tests/multi-device-sync.test.mjs`.

## Duplicate tasks typed on two devices

The same task typed separately on two devices before they synced (for example, while one was signed out) becomes two tasks with different IDs, each completed separately, so it showed twice. After each sync pull, exact duplicates are now merged automatically (`apps/web/lib/task-dedupe.ts`): same title (ignoring case and spacing), due date and time, project, section, notes and repeat rule. Every device keeps the copy with the smallest ID, so all devices converge; the survivor is completed if any copy was, gains the copies' tags and highest priority, and inherits their work sessions, linked events, reminders, routines and completion history (one completion per occurrence). The other copies are soft-deleted through a normal journaled write, so the merge syncs. Tasks that differ in any of those fields are never merged.

Fixed alongside: synced completions were stored with an extra `revision` field and remote completion deletions only stamped `deletedAt`, which the Dashboard ignores. Completions now keep their sync schema and are removed when deleted remotely, so undoing a completion on one device reopens the task on the others.

Covered by `tests/task-dedupe.test.mjs` and the typed-on-both-devices and undo scenarios in `tests/multi-device-sync.test.mjs`.

## Other Tasks count and iPhone status bar

- The Dashboard's OTHER TASKS header counted every task in the account instead of the tasks listed in the panel; it now shows the panel's own count (open and dimmed completed undated tasks).
- On iPhone, iOS drew a blurred strip of scrolled content behind the status bar. The page now uses `viewport-fit=cover`, pads the shell by the safe-area insets, and places a solid fixed strip in the navigation colour behind the status bar; the theme colour matches it.

Manual validation: on iPhone (Safari and the Home Screen app), confirm the area behind the clock and battery is solid with no blur while scrolling the Dashboard, that the tabs are not hidden under the status bar or notch in portrait and landscape, and that OTHER TASKS matches the number of listed tasks.

## Home Screen app status-bar blur

After the fix above, Safari was clean but the iPhone Home Screen app still showed a blurred top. In Home Screen apps, iOS 26 and later blurs the band just below the status bar itself; no page setting turns it off, and the phone tab strip started 7px into that band. On phone widths in the Home Screen app (`display-mode: standalone` with a touch pointer), the tab strip now has 24px of extra flat top padding in its own colour, so the blur falls on plain colour instead of the tabs. Safari tabs and wider layouts are unchanged; the wide sidebar already starts 28px down.

Manual validation: on iPhone, open the Home Screen app (fully close and reopen it after the deploy) and confirm the tabs are sharp, with only plain colour under the clock and battery, in portrait and landscape.
