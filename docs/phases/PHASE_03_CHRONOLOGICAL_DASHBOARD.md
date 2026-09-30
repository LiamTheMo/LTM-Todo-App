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
- Keep the Overdue section visible when there are no overdue tasks and show “Nothing overdue”.
- Use the existing Dashboard card, neutral surfaces and orange-brown accent palette for the Overdue section.
- Keep navigation and Dashboard controls fixed while the day stream scrolls. Extend a bounded window in either direction while preserving the visible date.
- Show completed task occurrences on their due/occurrence dates and completed scheduled work on scheduled dates with a muted completed treatment. Undated completed tasks use their local completion date. Keep Add controls available on past dates; a task added with a past due date is shown in Overdue until completed.
- Keep completion history in the Dashboard date stream instead of separate History navigation; retain completion records for undo and recurrence semantics.
- Return-to-Today control.
- Overdue treatment.
- Completion/edit interactions preserving scroll position.
- ScheduledBlock foundation sufficient to render task work reservations even before full calendar UI.

## Critical semantics
A task due Friday but scheduled Wednesday must appear Wednesday under Scheduled and Friday under Due. Scheduling never mutates due date. If completed Wednesday, the completed occurrence stays on Friday, its due/occurrence date. Avoid duplicate-looking cards when a task is both scheduled and due on the same date; use clear context. A past ScheduledBlock by itself is not overdue; only an unfinished task deadline before Today appears in Overdue. Past-due tasks remain in Overdue and must not be repeated in their old Due sections. Completed recurring occurrences use the saved occurrence date in the past timeline.

## Performance
Never construct an unbounded list of dates. Maintain a sliding query/render window and extend near boundaries. Cache derived day sections only with explicit invalidation. Measure large datasets.

## Accessibility
Day headings are semantic headings. Scheduled/Due grouping is announced. Relative labels are supplemented by full dates. Completion state does not rely on opacity/color alone. Reduced motion disables decorative transitions.

## Tests
Day bucketing; due-vs-scheduled split; today boundary; DST; locale/calendar fixtures; overdue; occurrence-date completion history; completed scheduled work; same-day schedule+due; empty-day collapse; deterministic ordering; bounded bidirectional scroll-window data source.

## Acceptance criteria
- Dashboard launches anchored at Today with previous completion dates available by scrolling upward and future dates available by scrolling downward.
- The Overdue section always appears above the day stream and shows “Nothing overdue” when empty.
- Navigation and Overdue stay in place while the day stream scrolls in both directions.
- Past dates show completed activity in a muted, accessible treatment and retain Add controls; past-dated unfinished tasks appear only in Overdue.
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
