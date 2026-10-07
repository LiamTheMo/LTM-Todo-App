# Product Specification

## Problem
Many task applications gate useful behavior behind subscriptions, impose arbitrary limits, or monetize attention with ads. LTM Todo should provide a capable personal task/planning system without designing basic productivity around monetization restrictions.

## Users
The supported product is a single owner using the responsive web app on desktop, iPhone and iPad. Task data is local to each browser. The architecture should support later multi-device accounts and synchronization; collaboration is later.

## Core concepts
**Task:** actionable work. May have a due date/time without being scheduled.
**Scheduled task block:** a time interval reserved to work on a task. Scheduling does not change the task's deadline.
**Event:** calendar commitment that is not inherently a completable task.
**Project:** organizational container for tasks.
**Section:** ordering/grouping inside a project.
**Tag:** cross-project classification.
**Reminder:** notification rule attached to a task. Event reminders are not currently shipped.
**Recurrence:** rule that generates/advances occurrences deterministically.
**Inbox:** captured work not yet organized.
**Dashboard:** chronological day stream combining scheduled items and due items.

## Dashboard
Dashboard is the default home surface. It opens at Today with an Overdue section above the date stream only when overdue tasks exist, then scrolls both forward into future dates and upward into past activity. Keep 31 calendar dates of past/current activity (Today plus the previous 30 days); older due tasks, completion history, and scheduled events expire from local storage automatically. Due dates cannot be assigned earlier than the first retained date. Past days show completed tasks and scheduled work dimmed and retain Add controls. A task added to a retained past day keeps that due date and appears both in Overdue and in Due on its assigned day while unfinished. Open tasks without due dates remain available in Tasks and appear in a separate Other Tasks panel on the Dashboard; hide that panel when empty. Due-dated completion history is grouped by due/occurrence date even when checked off on another day; undated tasks use local completion date. There is no separate History navigation. Each populated day shows a sticky date header, scheduled content ordered by time, and a visually separate Due section. Today/Tomorrow labels are contextual. Empty days should collapse rather than dominate scrolling. Keep a fast Return to Today action available while away from today. Overdue status comes from an unfinished task deadline, never from a day-to-day event or scheduled work block.

## v1 requirements
Unlimited local tasks/projects/sections/tags/reminders/recurrence rules; Inbox; Dashboard; task CRUD; priorities; notes; due date/time; scheduled blocks foundation; recurrence; notifications; search; filters; saved filters; safe bulk completion; completion history in the date stream; offline persistence; accessibility; responsive iPhone/iPad layouts.

The web client exposes the branded site icon in browser/search surfaces and supports adding the site to an iPhone Home Screen as a standalone web app.

## v2 requirements
First-party local calendars; timed/all-day events and recurring event series; a six-week month grid with previews and a selected-day agenda/timeline; multiple manageable local calendars with in-app rename/recolor/show-hide controls and a full-spectrum sRGB color wheel with 8-bit RGB selection (0–255 per channel); planned-work blocks; routines; templates; Kanban; saved views; bulk actions. Separate week/day/agenda mode tabs and drag-and-drop scheduling are not part of the shipped interface.

## v3 requirements
Authentication; cross-device task-data sync; conflict handling; tombstones; incremental sync; read-only subscriptions to HTTPS iCalendar (ICS) feed links; separate subscribed calendars with show/hide, color, last-refresh status and unsubscribe controls; backup/export; attachments; optional sharing/collaboration. Subscription refresh must not block offline task or calendar use. The production web client already exists; v3 adds accounts, synchronization and read-only external calendar feeds.

Subscribed feed events are external and read-only in LTM. Refreshes update existing items by stable source event identity, add new items, and remove cancelled/deleted source events without creating duplicates. Keep source calendars separate from user-owned LTM calendars and tasks. Treat subscription URLs as secrets, fetch and cache them through an authenticated backend, and protect the fetch path against SSRF, redirects to private networks, oversized feeds and abusive refreshes. Import only HTTPS iCalendar feeds for the initial release. Provider-specific OAuth and writing changes back to external calendars are separate future work.

## Explicit non-goals through v3
Advertising, paid feature gates, Google-account OAuth or write-back in the initial v3 release, AI-generated planning, enterprise administration, public social feeds.

## Workspace menu design
Tasks uses Open and Completed cards with quiet header counts, closest-deadline ordering, a search field with a clear action, contextual empty states, and an Add action in the Open header. Projects uses a card overview and separate section panels with task counts, inline Add/Edit controls, and visible empty drop areas. Creating projects stays in the overview; a selected project shows its own sections instead.

Settings is divided into keyboard-accessible collapsible groups with short descriptions. Account sync and push reminders open initially; storage, attachments, templates, routines, tags, sessions, and devices remain available by expanding their group. Preserve disclosure state while data and sync status update. Calendar keeps its month grid and day timeline, with wrapping toolbars, calendar chips, and a distinct selected-day header. Editors and picker menus share consistent spacing, clear close/save/cancel controls, and responsive touch targets. Keep the established Dashboard layout and warning palette.

Project management provides Edit from project cards and within a project. Users can rename projects, choose a full RGB color, or delete them after confirmation. Deleting a project preserves tasks and scheduled history, moves tasks and templates to Inbox, and removes its sections. Archived projects from older data remain available; archiving and archive settings are no longer offered. Open and Completed task headers use the same height.

Completed task retention: account preferences sync across devices and backups. Default 7 calendar days from completion; users can choose 1–14 days in Settings. Cleanup runs after account state is verified on open/sync and through normal journaled writes, producing cloud tombstones without resurrection. Active recurring tasks remain; their expired completion records are removed. Undated completed tasks sort below open tasks in Other Tasks. The 31-day window continues to apply to other Dashboard history.
