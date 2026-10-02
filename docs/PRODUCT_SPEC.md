# Product Specification

## Problem
Many task applications gate useful behavior behind subscriptions, impose arbitrary limits, or monetize attention with ads. LTM Todo should provide a capable personal task/planning system without designing basic productivity around monetization restrictions.

## Users
The current supported product is a single owner using the responsive web app on desktop, iPhone, and iPad. Task data is local to each browser. The architecture should support later multi-device accounts and synchronization; collaboration is later still. The native SwiftUI project is experimental source, not a released client.

## Core concepts
**Task:** actionable work. May have a due date/time without being scheduled.
**Scheduled task block:** a time interval reserved to work on a task. Scheduling does not change the task's deadline.
**Event:** calendar commitment that is not inherently a completable task.
**Project:** organizational container for tasks.
**Section:** ordering/grouping inside a project.
**Tag:** cross-project classification.
**Reminder:** notification rule attached to a task/event.
**Recurrence:** rule that generates/advances occurrences deterministically.
**Inbox:** captured work not yet organized.
**Dashboard:** chronological day stream combining scheduled items and due items.

## Dashboard
Dashboard is the default home surface. It opens at Today with a persistent Overdue section above the date stream, then scrolls both forward into future dates and upward into past activity. Keep seven calendar dates of past/current activity (Today plus the previous six days); older due tasks, completion history, and scheduled events expire from local storage automatically. Due dates cannot be assigned earlier than the first retained date. Past days show completed tasks and scheduled work dimmed and retain Add controls. A task added to a retained past day keeps that due date and appears both in Overdue and in Due on its assigned day while unfinished. Due-dated completion history is grouped by due/occurrence date even when checked off on another day; undated tasks use local completion date. There is no separate History navigation. Each populated day shows a sticky date header, scheduled content ordered by time, and a visually separate Due section. Today/Tomorrow labels are contextual. Empty days should collapse rather than dominate scrolling. Keep a fast Return to Today action available while away from today. Overdue status comes from an unfinished task deadline, never from a day-to-day event or scheduled work block.

## v1 requirements
Unlimited local tasks/projects/sections/tags/subtasks/reminders/recurrence rules; Inbox; Dashboard; task CRUD; priorities; notes; due date/time; scheduled blocks foundation; recurrence; notifications; search; filters; saved filters; safe bulk completion; completion history in the date stream; offline persistence; accessibility; responsive iPhone/iPad layouts.

The web client exposes the branded site icon in browser/search surfaces and supports adding the site to an iPhone Home Screen as a standalone web app.

## v2 requirements
First-party local calendars; timed/all-day events and recurring event series; a six-week month grid with previews and a selected-day agenda/timeline; multiple local calendars with an in-app full-spectrum sRGB color wheel and 8-bit RGB selection (0–255 per channel); planned-work blocks; routines; templates; Kanban; saved views; bulk actions. Separate week/day/agenda mode tabs and drag-and-drop scheduling are not part of the shipped interface.

## v3 requirements
Authentication; cross-device task-data sync; conflict handling; tombstones; incremental sync; backup/export; attachments; optional sharing/collaboration. The web production client already exists in v1/v2; v3 expands it with accounts and synchronization.

## Explicit non-goals through v3
Advertising, paid feature gates, Google Calendar as a core dependency, AI-generated planning, enterprise administration, public social feeds.
