# Phase 7 — First-Party Calendar & Events
**Target:** v2.00

## Objective
Add LTM Todo's own calendar rather than depending on Google Calendar.

## Scope
Calendar and CalendarEvent domain entities; multiple local calendars with semantic color tokens; timed/all-day events; event recurrence; day/week/month/agenda views; event detail/editor; calendar visibility controls; tasks/due indicators rendered alongside events without conflating entity types.

## Rules
Events are commitments; tasks are completable work. An event does not become a task merely because it appears near one. All-day values are dates, not midnight UTC instants. Timed events retain time-zone semantics. Calendar views consume the same scheduling domain used by Dashboard.

Event recurrence supports daily, weekly (selected weekdays), monthly, and yearly series with an interval and optional end date or occurrence count. Editing or deleting an event applies to its whole series; per-occurrence exceptions are outside this phase. Month summaries and agenda rows sort deterministically. A hidden calendar hides its events while leaving tasks and scheduled work visible.

## Layout
Handle overlapping events deterministically. Month cells show concise event/task previews without becoming unreadable. Selecting a day opens a chronological 24-hour timeline with timed events and planned-work blocks, separate all-day/deadline sections, and a current-time line that updates continuously while Today is selected. Keep text-based agenda alternatives for VoiceOver and small screens.

Calendar option menus use the app's custom selector surfaces instead of default iOS Picker menus. Date/time entry remains distinct from option selection. Opening a new task editor must leave the title field unfocused until the user taps it.

## Tests
All-day multi-day; overlap layout; DST; event recurrence; calendar visibility; month boundary; time-zone changes; Dashboard/calendar consistency; event previews in month cells; live now-line movement; task-editor keyboard remains hidden on open; custom selector accessibility.

## Acceptance criteria
Users can manage an entirely first-party calendar offline. No Google Calendar dependency is required. Event/task distinctions remain clear. Calendar and Dashboard agree on scheduled data.

## AI execution prompt
Implement Phase 7 from the existing local-first domain. Do not add external calendar APIs. Prioritize correct event/time semantics and deterministic overlap layout before visual polish. Execute CI loop and retain accessibility alternatives for geometry-based views.
