import test from "node:test";
import assert from "node:assert/strict";
import { completeTask, dashboardDays, emptyData } from "../lib/domain.ts";
import { mergeDuplicateTasks } from "../lib/task-dedupe.ts";
import { normalizeData } from "../lib/storage.ts";

const today = "2026-10-20";
const stamp = "2026-10-20T09:00:00.000Z";
const low = "1a1a1a1a-1111-4111-8111-111111111111";
const high = "9f9f9f9f-9999-4999-8999-999999999999";
const task = (id, extra = {}) => ({ id, title: "MKTG Midterm", notes: "", priority: "low", tagIds: [], sortKey: 1, dueDate: today,
  createdAt: stamp, updatedAt: stamp, revision: 1, ...extra });
const tag = id => ({ id, name: id.slice(0, 4), color: "orange", createdAt: stamp, updatedAt: stamp, revision: 1 });
const live = data => data.tasks.filter(item => !item.deletedAt);

test("the same task typed on two devices merges into one, the same way on every device", () => {
  const data = emptyData();
  const tagA = "2b2b2b2b-2222-4222-8222-222222222222";
  const tagB = "3c3c3c3c-3333-4333-8333-333333333333";
  data.tags.push(tag(tagA), tag(tagB));
  data.tasks.push(task(high, { title: "  mktg   midterm ", priority: "high", tagIds: [tagB], completedAt: "2026-10-20T15:17:00.000Z" }),
    task(low, { tagIds: [tagA] }));
  const merged = mergeDuplicateTasks(data, new Date("2026-10-20T16:00:00.000Z"));
  assert.deepEqual(live(merged).map(item => item.id), [low]);
  const survivor = live(merged)[0];
  assert.equal(survivor.completedAt, "2026-10-20T15:17:00.000Z");
  assert.equal(survivor.priority, "high");
  assert.deepEqual(survivor.tagIds.sort(), [tagA, tagB].sort());
  assert.equal(merged.tasks.find(item => item.id === high).deletedAt, "2026-10-20T16:00:00.000Z");
  // Another device holding the copies in the opposite order picks the same survivor.
  const reversed = mergeDuplicateTasks({ ...data, tasks: [...data.tasks].reverse() });
  assert.deepEqual(live(reversed).map(item => item.id), [low]);
  normalizeData(merged);
});

test("tasks that differ in due date, time, project, section, notes or repeat rule are not merged", () => {
  const projectId = "4d4d4d4d-4444-4444-8444-444444444444";
  for (const extra of [{ dueDate: "2026-10-21" }, { dueTime: "09:00", dueTimeZone: "UTC" }, { notes: "Room 204" }, { projectId },
    { recurrence: { frequency: "weekly", interval: 1, anchorDate: today, occurrences: 0 } }]) {
    const data = emptyData();
    data.projects.push({ id: projectId, name: "School", color: "orange", sortKey: 0, createdAt: stamp, updatedAt: stamp, revision: 1 });
    data.tasks.push(task(low), task(high, extra));
    assert.equal(mergeDuplicateTasks(data), data, JSON.stringify(extra));
  }
  const unchanged = emptyData();
  unchanged.tasks.push(task(low));
  assert.equal(mergeDuplicateTasks(unchanged), unchanged);
});

test("both copies' completions, sessions, events and reminders move to the survivor without duplicates", () => {
  let data = emptyData();
  data.tasks.push(task(low), task(high));
  data = completeTask(data, low, new Date("2026-10-20T14:59:00.000Z"));
  data = completeTask(data, high, new Date("2026-10-20T15:17:00.000Z"));
  assert.deepEqual(dashboardDays(data, today, 1, today)[0].completed.map(item => item.task.title), ["MKTG Midterm", "MKTG Midterm"]);
  const block = id => ({ id, startInstant: "2026-10-20T10:00:00.000Z", endInstant: "2026-10-20T11:00:00.000Z", timeZone: "UTC", createdAt: stamp, updatedAt: stamp, revision: 1 });
  data.blocks.push({ ...block("5e5e5e5e-5555-4555-8555-555555555555"), taskId: high });
  data.reminders.push({ id: "6f6f6f6f-6666-4666-8666-666666666666", taskId: high, minutesBefore: 15, enabled: true, createdAt: stamp, updatedAt: stamp, revision: 1 },
    { id: "7a7a7a7a-7777-4777-8777-777777777777", taskId: low, minutesBefore: 30, enabled: true, createdAt: stamp, updatedAt: stamp, revision: 1 });

  const merged = mergeDuplicateTasks(data);
  assert.deepEqual(merged.completions.map(item => [item.taskId, item.completedAt]), [[low, "2026-10-20T14:59:00.000Z"]]);
  assert.equal(merged.blocks[0].taskId, low);
  assert.deepEqual(merged.reminders.filter(item => !item.deletedAt).map(item => [item.taskId, item.minutesBefore]), [[low, 30]]);
  // The moved session lists the completed task under SCHEDULED; either way it appears exactly once that day.
  const [day] = dashboardDays(merged, today, 1, today);
  assert.deepEqual([...day.scheduled.map(item => item.task.id), ...day.completed.map(item => item.task.id)], [low]);
  normalizeData(merged);
});
