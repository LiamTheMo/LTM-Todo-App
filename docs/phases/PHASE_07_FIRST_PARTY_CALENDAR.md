# Phase 7 — First-Party Calendar & Events
**Target:** v2.00

## Objective
Add LTM Todo's own calendar rather than depending on Google Calendar.

## Scope
Calendar and CalendarEvent domain entities; multiple local calendars with custom full-spectrum sRGB colors (8-bit RGB channels); timed/all-day events; event recurrence; month grid with a selected-day agenda and timeline; (Separate Month/Week/Day/Agenda mode tabs are not used.) event detail/editor; calendar visibility controls; tasks/due indicators rendered alongside events without conflating entity types.

## Rules
Events are commitments; tasks are completable work. An event does not become a task merely because it appears near one. All-day values are dates, not midnight UTC instants. Timed events retain time-zone semantics. Calendar views consume the same scheduling domain used by Dashboard.

Event recurrence supports daily, weekly (selected weekdays), monthly, and yearly series with an interval and optional end date or occurrence count. Editing or deleting an event applies to its whole series; per-occurrence exceptions are outside this phase. Month summaries and agenda rows sort deterministically. A hidden calendar hides its events while leaving tasks and scheduled work visible.

## Layout
Handle overlapping events deterministically. Month cells show concise event/task previews without becoming unreadable. Selecting a day opens a chronological 24-hour timeline with timed events and planned-work blocks, separate all-day/deadline sections, and a current-time line that updates continuously while Today is selected. Keep text-based agenda alternatives for VoiceOver and small screens.

The supported web client uses app-styled calendar/date/time controls and leaves New Task's title unfocused until tapped. Native iOS Picker/DatePicker behavior is not part of the shipped client because the Apple app is experimental and not built or distributed by CI.

## Tests
All-day multi-day; overlap layout; DST; event recurrence; calendar visibility; month boundary; time-zone changes; Dashboard/calendar consistency; event previews in month cells; live now-line movement; task-editor keyboard remains hidden on open; custom selector accessibility; no native date/time pickers; date/time field widths match option fields.

## Acceptance criteria
Users can manage an entirely first-party calendar offline. No Google Calendar dependency is required. Event/task distinctions remain clear. Calendar and Dashboard agree on scheduled data.

## Current implementation note (2026-10-02)
The responsive web implementation has local calendars/events, a six-week month grid, event/task previews, selected-day agenda/timeline, and a full-spectrum in-app calendar color wheel with exact 0–255 RGB channel selection. There is no separate Week/Day/Agenda mode selector. Current-time marker refreshes every 15 seconds. Release validation is tracked in `docs/V2_STATUS.md`.

## AI execution prompt
Implement Phase 7 from the existing local-first domain. Do not add external calendar APIs. Prioritize correct event/time semantics and deterministic overlap layout before visual polish. Execute CI loop and retain accessibility alternatives for geometry-based views.
