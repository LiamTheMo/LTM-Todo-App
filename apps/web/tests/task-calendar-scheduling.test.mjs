import test from "node:test";
import assert from "node:assert/strict";
import { completeTask, dashboardDays, emptyData, newEntity, pruneExpiredHistory, saveTask, undoCompletion } from "../lib/domain.ts";
import { calendarEventsForDay, saveCalendarEvent, validEvent } from "../lib/calendar-domain.ts";
import { calendarTimelineItemsForDay } from "../lib/calendar-timeline-items.ts";
import { parseSyncPushBatch } from "../lib/sync-protocol.ts";

const now = new Date("2026-10-15T18:00:00.000Z");
const stamp = now.toISOString();
const day = "2026-10-17";
const taskId = "11111111-2222-4333-8444-555555555555";
const eventId = "22222222-3333-4444-8555-666666666666";
const task = (extra = {}) => ({
  ...newEntity(now), id: taskId, title: "Draft assignment", notes: "Chapter three",
  priority: "low", sortKey: 1, tagIds: [], dueDate: "2026-10-20", ...extra
});
const linkedEvent = (data, extra = {}) => ({
  ...newEntity(now), id: eventId, taskId, title: "Draft assignment", notes: "Chapter three",
  calendarId: data.calendars[0].id, allDay: false, timeZone: "UTC",
  startInstant: "2026-10-17T14:00:00.000Z", endInstant: "2026-10-17T15:00:00.000Z", ...extra
});
const seed = (extra = {}) => {
  const data = emptyData();
  data.tasks.push(task(extra));
  return data;
};

test("task time slots are real calendar events and appear once in the day timeline", () => {
  const data = seed();
  const created = saveCalendarEvent(data, linkedEvent(data));
  assert.equal(created.blocks.length, 0, "new sessions must not persist redundant scheduled blocks");
  assert.equal(created.calendarEvents.length, 1);
  assert.equal(created.calendarEvents[0].taskId, taskId);
  assert.equal(calendarEventsForDay(created, day)[0].event.id, eventId);
  const agenda = dashboardDays(created, day, 1, "2026-10-15")[0];
  assert.equal(agenda.scheduled.length, 1);
  assert.equal(agenda.scheduled[0].block.calendarEventId, eventId);
  assert.deepEqual(agenda.due, [], "scheduling must not move a task's deadline");
  assert.equal(created.tasks[0].dueDate, "2026-10-20");
  const items = calendarTimelineItemsForDay(created, day, "2026-10-15", agenda);
  assert.deepEqual(items.map(item => item.id), [`event:${eventId}:${day}`]);
  assert.match(items[0].caption, /Task event/);
});

test("linked calendar sessions can be rescheduled without creating duplicate records", () => {
  const data = seed();
  const saved = saveCalendarEvent(data, linkedEvent(data));
  const edited = saveCalendarEvent(saved, { ...saved.calendarEvents[0],
    startInstant: "2026-10-17T16:00:00.000Z", endInstant: "2026-10-17T17:00:00.000Z" });
  assert.equal(edited.calendarEvents.length, 1);
  assert.equal(edited.calendarEvents[0].id, eventId);
  assert.equal(edited.calendarEvents[0].revision, 2);
  assert.equal(dashboardDays(edited, day, 1, "2026-10-15")[0].scheduled[0].block.startInstant, "2026-10-17T16:00:00.000Z");
});

test("linked events reject all-day, recurrence, and missing task references", () => {
  const data = seed();
  const event = linkedEvent(data);
  assert.equal(validEvent({ ...event, allDay: true, startDate: day, endDate: "2026-10-18" }), false);
  assert.equal(validEvent({ ...event, recurrence: { frequency: "daily", interval: 1 } }), false);
  assert.equal(saveCalendarEvent(emptyData(), event).calendarEvents.length, 0);
  assert.equal(saveCalendarEvent(data, { ...event, taskId: "invalid" }).calendarEvents.length, 0);
});

test("linked events sync using the existing schema version and reject malformed links", () => {
  const data = seed();
  const event = linkedEvent(data);
  const mutation = {
    entityType: "calendarEvents", entityId: event.id,
    baseRevision: 0, operation: "upsert", clientMutationId: "33333333-4444-4555-8666-777777777777",
    clientSchemaVersion: 4, payload: event
  };
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [mutation] }).ok, true);
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [
    { ...mutation, payload: { ...event, taskId: "not-a-uuid" } }
  ] }).ok, false);
  assert.equal(parseSyncPushBatch({ protocolVersion: 1, mutations: [
    { ...mutation, payload: { ...event, allDay: true, startDate: day, endDate: "2026-10-18",
      startInstant: undefined, endInstant: undefined, timeZone: undefined } }
  ] }).ok, false);
});

test("renaming the task updates its linked event title without changing the due date", () => {
  const data = seed();
  const saved = saveCalendarEvent(data, linkedEvent(data));
  const updated = saveTask(saved, { ...saved.tasks[0], title: "Revised assignment", revision: 2 });
  assert.equal(updated.calendarEvents[0].title, "Revised assignment");
  assert.equal(updated.tasks[0].dueDate, "2026-10-20");
});

test("recurring completion removes future linked sessions and undo restores them", () => {
  const data = seed({ dueDate: day,
    recurrence: { frequency: "weekly", interval: 1, anchorDate: day, occurrences: 0 } });
  const saved = saveCalendarEvent(data, linkedEvent(data));
  const completed = completeTask(saved, taskId, new Date("2026-10-17T19:00:00Z"));
  assert.equal(completed.tasks[0].dueDate, "2026-10-24");
  assert.equal(completed.calendarEvents[0].deletedAt, "2026-10-17T19:00:00.000Z");
  assert.deepEqual(completed.completions[0].clearedBlockIds, [eventId]);
  const undone = undoCompletion(completed, completed.completions[0].id);
  assert.equal(undone.calendarEvents[0].deletedAt, undefined);
  assert.equal(undone.tasks[0].dueDate, day);
});

test("history cleanup removes linked events with their expired parent tasks", () => {
  const data = seed();
  const saved = saveCalendarEvent(data, linkedEvent(data));
  const pruned = pruneExpiredHistory(saved, "2026-12-01", true);
  assert.deepEqual(pruned.tasks, []);
  assert.deepEqual(pruned.calendarEvents, []);
});
