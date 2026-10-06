# Phase 3 — Chronological Dashboard
**Target:** v1.00

## Objective
Implement the defining LTM Todo home experience: a fast, continuous day-by-day stream of scheduled work and due work.

## Scope
- Date-window query service.
- Lazy/virtualized vertical day stream anchored to Today.
- Sticky date headers with Today/Tomorrow contextual labels.
- Scheduled area and separate Due area.
- Compact empty-day representation.
- A bidirectional day stream initially centered around Today, with past completion activity and future plans.
- A separate Overdue section above the day stream for unfinished tasks with a due date before the local current date.
- Show the Overdue section only when at least one task is overdue.
- Use the existing Dashboard card, neutral surfaces and orange-brown accent palette for the Overdue section.
- Keep navigation and Dashboard controls fixed while the day stream scrolls. Extend a bounded window in either direction while preserving the visible date, with no more than 31 calendar dates of past/current activity (Today plus the prior 30 days).
- Show completed task occurrences on their due/occurrence dates and completed scheduled work on scheduled dates with a muted completed treatment. Undated completed tasks use their local completion date. Keep Add controls available on retained past dates; a task added with a past due date remains in its date's Due group and is also shown in Overdue until completed.
- Keep completion history in the Dashboard date stream instead of separate History navigation. Retain completion records for undo and recurrence semantics while their occurrence date is within the 31-calendar-day window, then automatically remove expired history.
- Automatically remove tasks whose due date has left the retained 31-calendar-day window, old undated completed tasks, and scheduled-event records older than the cutoff. Clear expired schedules attached to otherwise-retained tasks. Open tasks without due dates remain available in Tasks and are omitted from the Dashboard.
- Return-to-Today control.
- Overdue treatment.
- Completion/edit interactions preserving scroll position.
- ScheduledBlock foundation sufficient to render task work reservations even before full calendar UI.

## Critical semantics
A task due Friday but scheduled Wednesday must appear Wednesday under Scheduled and Friday under Due. Scheduling never mutates due date. If completed Wednesday, the completed occurrence stays on Friday, its due/occurrence date. Avoid duplicate-looking cards when a task is both scheduled and due on the same date; use clear context. A past ScheduledBlock by itself is not overdue; only an unfinished task deadline before Today appears in Overdue. A retained past-due task appears in both Overdue and its original Due section. Completed recurring occurrences use the saved occurrence date in the past timeline until the date expires.

## Performance
Never construct an unbounded list of dates. Maintain a sliding query/render window and extend near boundaries. Cache derived day sections only with explicit invalidation. Measure large datasets.

## Accessibility
Day headings are semantic headings. Scheduled/Due grouping is announced. Relative labels are supplemented by full dates. Completion state does not rely on opacity/color alone. Reduced motion disables decorative transitions.

## Tests
Day bucketing; due-vs-scheduled split; today boundary; DST; locale/calendar fixtures; overdue; occurrence-date completion history; completed scheduled work; same-day schedule+due; empty-day collapse; deterministic ordering; bounded bidirectional scroll-window data source.

## Acceptance criteria
- Dashboard launches anchored at Today with previous completion dates available by scrolling upward and future dates available by scrolling downward.
- The Overdue section appears above the day stream only when overdue tasks exist.
- Navigation and Overdue stay in place while the day stream scrolls in both directions.
- The Dashboard exposes no more than 31 calendar dates of past/current activity; expired task and event history is removed automatically.
- Past dates show retained completed activity in a muted, accessible treatment and retain Add controls; retained past-dated unfinished tasks appear in both Overdue and their original Due section.
- Completion history is accessible from past dates without separate History navigation.
- Continuous scrolling works without opening date pickers.
- Sticky headers update correctly.
- Return to Today is reliable.
- Scheduled and Due meanings are visually and semantically distinct.
- Scrolling/editing does not unexpectedly reset position.
- Large date ranges remain performant.

## Manual validation
Test around midnight, DST fixture/simulator timezone changes, long scroll in both directions, Return to Today, add controls on past dates, large Dynamic Type, VoiceOver, iPad pointer/keyboard, and independent web content scrolling.

## AI execution prompt
Implement the Dashboard as the primary v1 experience. Begin from DASHBOARD_UX.md and DATA_MODEL.md, write date-bucketing tests before UI assumptions, then build lazy rendering. Do not collapse due and scheduled timestamps into one field. Execute the full CI/review loop and merge only when behavior and performance criteria pass.
