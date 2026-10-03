import test from "node:test";
import assert from "node:assert/strict";
import { normalizeData } from "../lib/storage.ts";

test("legacy v1 snapshots gain missing collections and a generation without losing tasks", () => {
  const legacy = { schemaVersion: 1, tasks: [{ id: "task", title: "Keep me", notes: "", tagIds: [], sortKey: 1,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", revision: 1 }] };
  const restored = normalizeData(legacy);
  assert.equal(restored.generation, 0);
  assert.equal(restored.tasks[0].title, "Keep me");
  assert.deepEqual(restored.sections, []);
  assert.deepEqual(restored.completions, []);
  assert.deepEqual(restored.savedViews, []);
  assert.equal(restored.schemaVersion, 4);
  assert.deepEqual(restored.calendarEvents, []);
  assert.equal(restored.calendars[0].name, "Personal");
  assert.equal(normalizeData({ ...legacy, generation: 7 }).generation, 7);
});

test("legacy subtasks migrate to standalone tasks without losing task records", () => {
  const base = { id: "parent", title: "Parent", notes: "", tagIds: [], sortKey: 1,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", revision: 1 };
  const restored = normalizeData({ schemaVersion: 1, tasks: [
    base, { ...base, id: "child", title: "Child", parentTaskId: "parent" },
    { ...base, id: "nested", title: "Nested child", parentTaskId: "child" }
  ] });
  assert.equal(restored.tasks.length, 3);
  assert.deepEqual(restored.tasks.map(task => task.id), ["parent", "child", "nested"]);
  assert.ok(restored.tasks.every(task => !("parentTaskId" in task)));
  assert.throws(() => normalizeData({ schemaVersion: 1, tasks: [{ ...base, projectId: "missing" }] }), /missing project/);
});

test("normalization preserves large standalone task collections", () => {
  const tasks = [];
  const count = 5000;
  for (let index = 0; index < count * 2; index++) tasks.push({ id: `task-${index}`, title: `Task ${index}`, tagIds: [], sortKey: index,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", revision: 1 });
  const start = performance.now();
  assert.equal(normalizeData({ schemaVersion: 1, tasks }).tasks.length, count * 2);
  assert.ok(performance.now() - start < 2500, "10,000 task normalization should finish within 2.5 seconds");
});

test("corrupt or unsupported snapshots fail closed instead of being replaced", () => {
  assert.throws(() => normalizeData({ schemaVersion: 5, tasks: [] }), /Unsupported/);
  assert.throws(() => normalizeData({ schemaVersion: 1, tasks: "not an array" }), /Invalid tasks/);
  assert.throws(() => normalizeData({ schemaVersion: 1, tasks: [{ id: "a", title: "", tagIds: [], sortKey: 1,
    createdAt: "2026-01-01", updatedAt: "2026-01-01", revision: 1 }] }), /Invalid local task/);
  assert.throws(() => normalizeData({ schemaVersion: 1, generation: -1 }), /generation/);
  assert.throws(() => normalizeData({ schemaVersion: 1, tags: [{ id: "same", createdAt: "", updatedAt: "", revision: 1 },
    { id: "same", createdAt: "", updatedAt: "", revision: 1 }] }), /duplicate tags/);
});

test("calendar event records require an existing calendar and valid event dates", () => {
  const calendar = { id: "calendar", name: "Personal", color: "orange", visible: true, sortKey: 0,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", revision: 1 };
  const event = { id: "event", calendarId: "calendar", title: "Appointment", notes: "", allDay: true,
    startDate: "2026-01-05", endDate: "2026-01-06", createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z", revision: 1 };
  const restored = normalizeData({ schemaVersion: 2, calendars: [calendar], calendarEvents: [event] });
  assert.equal(restored.calendarEvents[0].title, "Appointment");
  assert.throws(() => normalizeData({ schemaVersion: 2, calendars: [calendar], calendarEvents: [{ ...event, calendarId: "missing" }] }), /Invalid calendar event/);
  assert.throws(() => normalizeData({ schemaVersion: 2, calendars: [calendar], calendarEvents: [{ ...event, endDate: "2026-01-01" }] }), /Invalid calendar event/);
});

test("schema v2 calendar snapshots migrate to color schema v4 without losing events", () => {
  const calendar = { id: "calendar", name: "Personal", color: "orange", visible: true, sortKey: 0,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", revision: 1 };
  const event = { id: "event", calendarId: "calendar", title: "Appointment", notes: "", allDay: true,
    startDate: "2026-01-05", endDate: "2026-01-06", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", revision: 1 };
  const restored = normalizeData({ schemaVersion: 2, calendars: [calendar], calendarEvents: [event] });
  assert.equal(restored.schemaVersion, 4);
  assert.equal(restored.calendarEvents[0].title, "Appointment");
  assert.deepEqual(restored.taskTemplates, []);
  assert.deepEqual(restored.routines, []);
});

test("custom calendar colors persist and named colors migrate to canonical hex", () => {
  const calendarBase = { id: "calendar", name: "Personal", visible: true, sortKey: 0,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", revision: 1 };
  const restored = normalizeData({ schemaVersion: 3, calendars: [
    { ...calendarBase, color: "orange" },
    { ...calendarBase, id: "custom", name: "Custom", color: "#12aBcD" }
  ] });
  assert.equal(restored.schemaVersion, 4);
  assert.equal(restored.calendars[0].color, "#CF6D27");
  assert.equal(restored.calendars[1].color, "#12ABCD");
  assert.throws(() => normalizeData({ schemaVersion: 4, calendars: [{ ...calendarBase, color: "invalid" }] }), /Invalid local calendar/);
});
