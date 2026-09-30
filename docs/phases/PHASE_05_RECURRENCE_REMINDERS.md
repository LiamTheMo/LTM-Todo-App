# Phase 5 — Recurrence, Reminders & Notifications
**Target:** v1.00

## Objective
Make repeating work and reminders trustworthy enough for daily use.

## Scope
Structured recurrence rules for daily/weekly/monthly/yearly and interval patterns; selected weekdays; end conditions; completion-based vs calendar-based advancement where specified; multiple reminders; relative reminders; local notification scheduling/cancellation; snooze actions where platform permits; recurrence history.

## Time semantics
Recurrence evaluates in an explicit calendar/time zone. Define behavior for nonexistent/ambiguous DST times. Date-only recurring tasks remain date-based. Completing one occurrence must not destroy historical truth or generate duplicates after restart.

## Reliability
Notification scheduling is derived from persisted reminder state and reconciled after edits/relaunch. Respect platform notification limits by scheduling a rolling horizon if necessary. Permission denial must degrade gracefully.

## Tests
Monthly edge dates; leap year; DST spring/fall; weekday selections; end after count/date; edit series; complete occurrence; missed occurrence; reminder reschedule/cancel; permission denied abstractions; restart reconciliation.

## Acceptance criteria
No duplicate occurrences under normal/restart flows. Editing a due date correctly updates reminders. Recurrence history is inspectable in the Dashboard's past-day timeline. App remains useful with notifications denied.

For the local-only v1 web client, reminder delivery uses browser notifications while the app is open and reconciles a rolling seven-day timer window. A closed browser cannot run local timers; reliable background delivery requires a push service, so background web delivery is outside the v1 guarantee. Native Apple local notifications are scheduled by the OS and remain subject to permission and platform limits.

## Manual validation
Real device notification delivery, snooze/actions, timezone change, device restart/relaunch, permission transitions.

## AI execution prompt
Treat recurrence as correctness-critical domain code. Implement pure recurrence evaluation with extensive deterministic fixtures before notification UI. Do not encode recurrence only as human-readable strings. Run all date/time tests and classify real-device notification checks as Manual Validation.
