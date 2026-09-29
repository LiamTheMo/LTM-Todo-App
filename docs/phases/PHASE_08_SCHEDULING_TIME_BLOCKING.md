# Phase 8 — Scheduling, Time Blocking & Calendar Interaction
**Target:** v2.00

## Objective
Turn the calendar into an active planning surface where tasks can be assigned work time without changing deadlines.

## Scope
Drag/drop tasks into day/week calendar to create ScheduledBlocks; resize/move blocks; unschedule; schedule from a clear calendar/day-planning surface; optional multiple blocks per task; conflict/overlap presentation; planning tray/backlog; undo; keyboard-accessible scheduling alternatives. Avoid unexplained generic “work starts/ends” fields in the basic task editor.

## Core invariant
`dueAt` and `ScheduledBlock(start,end)` are independent. Every mutation path must preserve this invariant.

## Interaction
Dragging should snap to configurable intervals while retaining precise editing. Auto-scroll near calendar edges. Invalid drops revert predictably. Touch, pointer and keyboard interactions receive equivalent functional paths.

## Tests
Schedule/unschedule; move/resize; due date unchanged; multiple blocks; overlap; DST crossing; undo; persistence; Dashboard/calendar consistency.

## Acceptance criteria
Scheduling feels immediate offline. A user can see when they plan to work and when work is actually due. No interaction silently modifies a deadline.

## AI execution prompt
Implement scheduling around the due-vs-scheduled invariant. Add domain tests that fail if any scheduling command mutates due fields. Then implement touch/pointer/keyboard interactions and validate Dashboard consistency.
