# Dashboard UX Specification

## Purpose
The Dashboard answers: **What is happening and what is due, day by day?** It replaces the need for separate Today and Upcoming top-level pages.

## Structure
A vertically scrolling date stream. Each date section has:
1. Sticky date header: relative label when useful + formatted date.
2. Scheduled area: events and scheduled task blocks in chronological order.
3. Due area: incomplete tasks whose deadline falls on the date.
4. Optional completed area, collapsed/de-emphasized by default.

A task scheduled today but due Friday appears as scheduled today and due Friday. The UI must not imply its deadline moved.

## Behavior
- Launch anchored to Today.
- Scroll downward into future days and upward into recent history.
- Date header sticks and transitions as the next day reaches it.
- Return-to-Today control appears after meaningful displacement.
- Empty days collapse to a compact row; allow preference to hide entirely later.
- Overdue unfinished tasks are visible without duplicating confusing entries.
- Completion is optimistic/local and immediately reflected.
- Tapping an item opens detail without losing scroll position.
- Quick add defaults intelligently to current dashboard context but must make the assigned date obvious.
- Search/filter state must be visibly distinguishable from the normal dashboard.

## Accessibility
Date boundaries cannot rely on color alone. Support Dynamic Type, VoiceOver semantic grouping, keyboard navigation on iPad/web, sufficient targets, reduced motion and logical focus after completion/deletion.

## Performance
Use virtualized/lazy rendering. Do not materialize years of empty dates. Query date windows and expand as the user approaches boundaries.

## Acceptance examples
- A task due Oct 5 and scheduled Oct 3 appears in Oct 3 Scheduled and Oct 5 Due.
- Completing it Oct 3 removes/marks the future due presentation according to completion rules.
- A date-only deadline remains on the same local calendar date across DST/zone changes according to defined semantics.
