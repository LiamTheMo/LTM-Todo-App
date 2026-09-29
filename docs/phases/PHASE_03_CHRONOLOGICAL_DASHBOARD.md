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
- A forward-only day stream that begins at Today and continues into future days.
- A separate Overdue section above the day stream for unfinished tasks with a due date before the local current date.
- Return-to-Today control.
- Overdue treatment.
- Completion/edit interactions preserving scroll position.
- ScheduledBlock foundation sufficient to render task work reservations even before full calendar UI.

## Critical semantics
A task due Friday but scheduled Wednesday must appear Wednesday under Scheduled and Friday under Due. Scheduling never mutates due date. If completed Wednesday, Friday presentation reflects completion rules rather than pretending the deadline changed. Avoid duplicate-looking cards when a task is both scheduled and due on the same date; use clear context. A past ScheduledBlock by itself is not overdue; only an unfinished task deadline before Today appears in Overdue.

## Performance
Never construct an unbounded list of dates. Maintain a sliding query/render window and extend near boundaries. Cache derived day sections only with explicit invalidation. Measure large datasets.

## Accessibility
Day headings are semantic headings. Scheduled/Due grouping is announced. Relative labels are supplemented by full dates. Completion state does not rely on opacity/color alone. Reduced motion disables decorative transitions.

## Tests
Day bucketing; due-vs-scheduled split; today boundary; DST; locale/calendar fixtures; overdue; completion; same-day schedule+due; empty-day collapse; deterministic ordering; scroll-window data source.

## Acceptance criteria
- Dashboard launches at the top of Overdue (when present), followed by Today and future dates; it does not list previous dates.
- Continuous scrolling works without opening date pickers.
- Sticky headers update correctly.
- Return to Today is reliable.
- Scheduled and Due meanings are visually and semantically distinct.
- Scrolling/editing does not unexpectedly reset position.
- Large date ranges remain performant.

## Manual validation
Test around midnight, DST fixture/simulator timezone changes, long future scroll, large Dynamic Type, VoiceOver, iPad pointer/keyboard, web wheel/trackpad when web implementation reaches this phase.

## AI execution prompt
Implement the Dashboard as the primary v1 experience. Begin from DASHBOARD_UX.md and DATA_MODEL.md, write date-bucketing tests before UI assumptions, then build lazy rendering. Do not collapse due and scheduled timestamps into one field. Execute the full CI/review loop and merge only when behavior and performance criteria pass.
