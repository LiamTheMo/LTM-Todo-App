# Product Specification

## Problem
Many task applications gate useful behavior behind subscriptions, impose arbitrary limits, or monetize attention with ads. LTM Todo should provide a capable personal task/planning system without designing basic productivity around monetization restrictions.

## Users
Initial product focus is a single owner using iPhone, iPad and web. The architecture must not assume only one device. Collaboration is deliberately later.

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
First-party calendar; day/week/month/agenda; event CRUD; all-day/timed events; multiple local calendars/colors; drag/drop scheduling; time blocking; routines; templates; Kanban; advanced smart views; bulk editing beyond safe task completion; advanced planning.

## v3 requirements
Authentication; cross-device sync; conflict handling; tombstones; incremental sync; backup/export; attachments; web production client; optional sharing/collaboration.

## Explicit non-goals through v3
Advertising, paid feature gates, Google Calendar as a core dependency, AI-generated planning, enterprise administration, public social feeds.
