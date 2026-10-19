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
