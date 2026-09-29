# Domain Data Model

## Task
id UUID; title; notes; status; priority; projectId?; sectionId?; parentTaskId?; dueDate?; dueTime?; dueTimeZone?; createdAt; updatedAt; completedAt?; sortKey; recurrenceRuleId?; deletedAt?; revision.

A due date/time is a deadline, not a work reservation.

## ScheduledBlock
id UUID; taskId; startInstant; endInstant; timeZone; createdAt; updatedAt; deletedAt?; revision.
A task may eventually support more than one work block. Completing a block does not necessarily complete its task.

## CalendarEvent
id UUID; calendarId; title; notes; allDay; start/end representation; timeZone; recurrenceRuleId?; createdAt; updatedAt; deletedAt?; revision.

## Project
id UUID; name; icon?; colorToken?; archivedAt?; sortKey; createdAt; updatedAt; deletedAt?; revision.

## Section
id UUID; projectId; name; sortKey; createdAt; updatedAt; deletedAt?; revision.

## Tag / TaskTag
Tags are many-to-many. Tag identity must survive renames.

## Reminder
id UUID; targetType; targetId; trigger model; enabled; createdAt; updatedAt; deletedAt?; revision.
Triggers may be absolute or relative to due/scheduled/event time.

## RecurrenceRule
Structured rule containing frequency, interval, selected weekdays/month rules, end condition, recurrence time zone, and advancement semantics. Do not store only an RRULE string unless an ADR establishes it as the canonical representation.

## CompletionOccurrence
Record recurring completion history separately enough to answer what happened on a particular occurrence without corrupting the recurrence template.

## ChangeJournal (v3)
localChangeId; entityType; entityId; operation; baseRevision; payload/version; occurredAt; syncState.

## Ordering
Use stable sortable keys suitable for local reorder without rewriting an entire list. Define deterministic tie-breaking.

## Deletion
Syncable deletion is soft/tombstoned until server retention/compaction policy permits physical deletion.
