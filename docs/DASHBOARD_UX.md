# Dashboard UX Specification

## Purpose
The Dashboard answers: **What is happening and what is due, day by day?** It replaces separate Today, Upcoming and History navigation.

## Structure
The app shell stays within the viewport; navigation and Dashboard controls remain in place while the content pane scrolls. The date stream opens at Today, scrolls down into future dates and up into past activity. An Overdue section stays visible above the stream; unfinished task deadlines before the current local date appear there, and an empty section says “Nothing overdue”.

Each date section has:
1. Sticky date header: relative label when useful + formatted date.
2. Scheduled area: events and scheduled task blocks in chronological order.
3. Due area: incomplete tasks whose deadline falls on the date.
4. Completed area: task occurrences and scheduled work completed on that date, shown with a muted completed treatment.

A task scheduled today but due Friday appears as scheduled today and due Friday. The UI must not imply its deadline moved. Completion activity is grouped by its local completion date, including recurring task occurrences.

## Behavior
- Launch anchored to Today while retaining loaded dates before and after it.
- Scroll down into future days and up into completed past activity; extend a bounded date window near either edge while preserving the visible day.
- Day headers stick within the date stream. The Dashboard itself does not scroll with the browser page; navigation and Overdue remain in place.
- Return-to-Today stays available while away from Today.
- Past dates show completed tasks and completed scheduled work dimmed. Do not offer add controls on past dates. Existing rows may still be opened or undone when that completion is the latest occurrence.
- Empty days collapse to a compact row; past empty days say “No completed items”.
- Overdue means an unfinished task with a due date before the current local date. A scheduled event or work block without an expired task deadline is never overdue.
- Overdue tasks appear once in their own section and are not repeated in past date sections.
- Keep the Overdue section visible when empty and show “Nothing overdue”. Style its title at the same size as the day heading, with a noticeable orange-red accent and the Dashboard's warm neutral surfaces.
- Completion is optimistic/local and immediately reflected.
- Tapping an item opens detail without losing scroll position.
- Quick add defaults intelligently to current dashboard context but must make the assigned date obvious.
- Search/filter state must be visibly distinguishable from the normal dashboard.

## Accessibility
Date boundaries cannot rely on color alone. Support Dynamic Type, VoiceOver semantic grouping, keyboard navigation on iPad/web, sufficient targets, reduced motion and logical focus after completion/deletion. The earlier/later date-window controls must remain keyboard and accessibility operable.

## Performance
Use virtualized/lazy rendering. Keep a bounded window around the visible date and shift it in overlapping steps; do not materialize years of empty dates. Query date windows and extend as the user approaches boundaries.

## Acceptance examples
- A task due Oct 5 and scheduled Oct 3 appears Oct 3 under Scheduled and Oct 5 under Due.
- Completing it Oct 3 removes/marks the future due presentation according to completion rules.
- A completed task occurrence appears, dimmed, on its local completion date; it is not repeated in the Due section.
- An unfinished task due Oct 3 appears in Overdue while browsing Oct 3, not a second time in that past date section.
- A date-only deadline remains on the same local calendar date across DST/zone changes according to defined semantics.
- Past date sections contain no Add controls, and scrolling the date stream does not move the app navigation or Overdue section.
