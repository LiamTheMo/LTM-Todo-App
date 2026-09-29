# Phase 7 — First-Party Calendar & Events
**Target:** v2.00

## Objective
Add LTM Todo's own calendar rather than depending on Google Calendar.

## Scope
Calendar and CalendarEvent domain entities; multiple local calendars with semantic color tokens; timed/all-day events; event recurrence; day/week/month/agenda views; event detail/editor; calendar visibility controls; tasks/due indicators rendered alongside events without conflating entity types.

## Rules
Events are commitments; tasks are completable work. An event does not become a task merely because it appears near one. All-day values are dates, not midnight UTC instants. Timed events retain time-zone semantics. Calendar views consume the same scheduling domain used by Dashboard.

## Layout
Handle overlapping events deterministically. Month cells summarize without becoming unreadable. Day/week views support current-time indicator and accessible alternatives to visual geometry.

## Tests
All-day multi-day; overlap layout; DST; event recurrence; calendar visibility; month boundary; time-zone changes; Dashboard/calendar consistency.

## Acceptance criteria
Users can manage an entirely first-party calendar offline. No Google Calendar dependency is required. Event/task distinctions remain clear. Calendar and Dashboard agree on scheduled data.

## AI execution prompt
Implement Phase 7 from the existing local-first domain. Do not add external calendar APIs. Prioritize correct event/time semantics and deterministic overlap layout before visual polish. Execute CI loop and retain accessibility alternatives for geometry-based views.
