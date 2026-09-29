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
Dashboard is the default home surface. It scrolls vertically through dates. Every populated day shows a sticky date header, scheduled content ordered by time, and a visually separate Due section. Today/Tomorrow labels are contextual. Empty days should collapse rather than dominate scrolling. When away from today, expose a fast Return to Today action. Previous dates may be reachable upward; unfinished past work is marked overdue and completed work is visually de-emphasized.

## v1 requirements
Unlimited local tasks/projects/sections/tags/subtasks/reminders/recurrence rules; Inbox; Dashboard; task CRUD; priorities; notes; due date/time; scheduled blocks foundation; recurrence; notifications; search; filters; completion history; offline persistence; accessibility; responsive iPhone/iPad layouts.

## v2 requirements
First-party calendar; day/week/month/agenda; event CRUD; all-day/timed events; multiple local calendars/colors; drag/drop scheduling; time blocking; routines; templates; Kanban; saved smart views; bulk editing; advanced planning.

## v3 requirements
Authentication; cross-device sync; conflict handling; tombstones; incremental sync; backup/export; attachments; web production client; optional sharing/collaboration.

## Explicit non-goals through v3
Advertising, paid feature gates, Google Calendar as a core dependency, AI-generated planning, enterprise administration, public social feeds.
