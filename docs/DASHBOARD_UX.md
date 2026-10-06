# Dashboard UX Specification

## Purpose
The Dashboard answers: **What is happening and what is due, day by day?** It replaces separate Today, Upcoming and History navigation.

## Structure
The app shell stays within the viewport; navigation and Dashboard controls remain in place while the content pane scrolls. The date stream opens at Today, scrolls down into future dates and up through a 31-calendar-day history window (Today plus the previous 30 days). Older due tasks, completion history, and scheduled events expire from local storage automatically. An Overdue section stays visible above the stream; unfinished task deadlines before the current local date appear there, and an empty section says “Nothing overdue”.

Each date section has:
1. Sticky date header: relative label when useful + formatted date.
2. Scheduled area: events and scheduled task blocks in chronological order.
3. Due area: incomplete tasks whose deadline falls on the date.
4. Completed area: due-dated task occurrences on their due/occurrence dates, undated task completions on their completion dates, and completed scheduled work on its scheduled date; show all with a muted completed treatment.

A task scheduled today but due Friday appears as scheduled today and due Friday. The UI must not imply its deadline moved. A completed task occurrence stays in the Completed area on its due/occurrence date, even when the user checks it off on a different date. Undated completions use the local completion date. A completed scheduled block stays on its scheduled date.

## Behavior
- Launch anchored to Today while retaining loaded dates before and after it.
- Scroll down into future days and up through the retained past month; extend the bounded date window near either edge while preserving the visible day, without allowing the history boundary to move earlier than 30 days before Today.
- Day headers stick within the date stream. The Dashboard itself does not scroll with the browser page; navigation and Overdue remain in place.
- Return-to-Today stays available while away from Today.
- Past dates show retained completed tasks and completed scheduled work dimmed. Keep Add controls available for the retained past dates; a task added with a past due date appears both in Overdue and in Due on its assigned date. Existing rows may still be opened or undone when that completion is the latest occurrence.
- Empty days collapse to a compact row; past empty days say “No completed items” and still offer Add.
- Overdue means an unfinished task with a due date before the current local date. A scheduled event or work block without an expired task deadline is never overdue.
- Overdue tasks appear in the Overdue section and remain in Due on their assigned date while that date is within the retained month.
- Each overdue task shows its deadline as a relative calendar-day label, such as “Due 2 days ago”; use “day” for one day.
- Keep the Overdue section visible when empty and show “Nothing overdue”. Style its title at the same size as the day heading, with a noticeable orange-red accent and the Dashboard's warm neutral surfaces.
- Completion is optimistic/local and immediately reflected.
- Tapping an item opens detail without losing scroll position.
- Quick add defaults intelligently to current dashboard context but must make the assigned date obvious.
- Search/filter state must be visibly distinguishable from the normal dashboard.

## Dashboard task coverage
Dated tasks, scheduled work and recent completions appear in their Dashboard day groups; overdue tasks also appear in Overdue. Dated tasks outside the visible range appear in Other Tasks. Open tasks without due dates stay in Tasks and are omitted from the Dashboard.

## Calendar surface
The Calendar view is a local planning surface over tasks, planned-work blocks and first-party calendar events.

- The month view is a six-week grid with event/task previews in each date cell, Previous/Next month controls and a Today action.
- Selecting a date shows its agenda and chronological timeline. Timed events and planned-work blocks appear in the timeline; deadlines remain distinct. The current-time marker on Today refreshes every 15 seconds.
- The calendar has no separate Month/Week/Day/Agenda mode selector. Month navigation plus selecting a date are the available controls.
- Calendar creation is an in-app form with a full-spectrum sRGB color wheel and exact 0–255 RGB channel inputs. Task and event date/time/option fields use app-styled web controls; opening New Task does not focus the title field.
- The supported responsive web client uses Dashboard date-only semantics and the same rolling history boundary. Displaying planned work never changes a task deadline.
- Navigation order is Dashboard, Tasks, Projects, Calendar, Settings. Tasks is a status-based Kanban with text search and no other task filter controls; tasks with due dates sort earliest first within each status column, and undated tasks follow them. Settings is shown as a gear icon.
- The floating add button is available on Dashboard, Tasks, Projects and Calendar. It opens the shared composer with Task and Calendar tabs and carries the selected calendar date or active project into the new item where applicable. In the Calendar tab, start/end dates and times sit side by side on mobile.

## Accessibility
Date boundaries cannot rely on color alone. Support responsive layouts, keyboard navigation, sufficient targets, reduced motion and logical focus after completion/deletion. Date-window controls must remain keyboard and accessibility operable.

## Performance
Use virtualized/lazy rendering. Keep a bounded window around the visible date and shift it in overlapping steps; do not materialize years of empty dates. Query date windows and extend as the user approaches boundaries.

## Acceptance examples
- A task due Oct 5 and scheduled Oct 3 appears Oct 3 under Scheduled and Oct 5 under Due.
- Completing it Oct 3 removes/marks the future due presentation according to completion rules.
- A completed task occurrence appears, dimmed, on its due/occurrence date; it is not repeated in the Due section. Checking it off on another date does not move it. It expires after its date leaves the retained 31-calendar-day window.
- An unfinished task due Oct 3 appears in Overdue and in Due while browsing Oct 3, as long as Oct 3 is within the retained week.
- Adding a task from Oct 3 when today is Oct 4 sets its due date to Oct 3 and immediately lists it in both Overdue and that date's Due group.
- The earliest retained date is 30 calendar days before Today. Older tasks and scheduled events are deleted automatically, and users cannot assign a new due date before that boundary.
- A date-only deadline remains on the same local calendar date across DST/zone changes according to defined semantics.
- Past date sections retain Add controls, and scrolling the date stream does not move the app navigation or Overdue section.

## Supported-client note (2026-10-03)
This specification describes intended Dashboard behavior for the responsive web app on desktop, iPhone and iPad. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for what is currently shipped and [V2_STATUS.md](V2_STATUS.md) for remaining manual checks.
