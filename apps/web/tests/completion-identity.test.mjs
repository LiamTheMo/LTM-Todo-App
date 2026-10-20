import test from "node:test";
import assert from "node:assert/strict";
import { completeTask, completionIdFor, dashboardDays, emptyData, undoCompletion } from "../lib/domain.ts";
import { normalizeData } from "../lib/storage.ts";

const today = "2026-10-20";
const syncUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const taskId = "4fef5e72-f114-4ea5-8d40-9d8069654f40";
const stamp = "2026-10-20T09:00:00.000Z";
function withTask(extra = {}) {
  const data = emptyData();
  data.tasks.push({ id: taskId, title: "Pay rent", notes: "", priority: "low", tagIds: [], sortKey: 1, dueDate: today,
    createdAt: stamp, updatedAt: stamp, revision: 1, ...extra });
  return data;
}

test("completion IDs are stable per task occurrence and valid sync UUIDs", () => {
  const id = completionIdFor(taskId, today);
  assert.match(id, syncUuid);
  assert.equal(completionIdFor(taskId, today), id);
  assert.notEqual(completionIdFor(taskId, "2026-10-21"), id);
  assert.notEqual(completionIdFor("0a2f5d6e-9c1b-4d7e-8f30-2b4c6d8e0f12", today), id);
  for (let index = 0; index < 200; index++) assert.match(completionIdFor(crypto.randomUUID(), String(index)), syncUuid);
});

test("completing the same task on two devices produces the same completion record", () => {
  const phone = completeTask(withTask(), taskId, new Date("2026-10-20T10:00:00.000Z"));
  const laptop = completeTask(withTask(), taskId, new Date("2026-10-20T10:05:00.000Z"));
  assert.equal(phone.completions[0].id, laptop.completions[0].id);
});

test("completing again over a synced copy of the same completion replaces it instead of duplicating it", () => {
  const synced = completeTask(withTask(), taskId, new Date("2026-10-20T10:00:00.000Z"));
  // The task itself is open here (for example, a newer local edit reopened it) while the completion arrived by sync.
  const reopened = { ...synced, tasks: synced.tasks.map(task => ({ ...task, completedAt: undefined })) };
  const again = completeTask(reopened, taskId, new Date("2026-10-20T11:00:00.000Z"));
  assert.equal(again.completions.length, 1);
  assert.equal(again.completions[0].completedAt, "2026-10-20T11:00:00.000Z");
  normalizeData(again);
});

test("existing duplicate completions show once and are undone together", () => {
  const data = withTask({ completedAt: "2026-10-20T10:05:00.000Z" });
  data.completions.push(
    { id: crypto.randomUUID(), taskId, occurrenceDate: today, completedAt: "2026-10-20T10:00:00.000Z" },
    { id: crypto.randomUUID(), taskId, occurrenceDate: today, completedAt: "2026-10-20T10:05:00.000Z" });
  const [day] = dashboardDays(data, today, 1, today);
  assert.deepEqual(day.completed.map(item => [item.task.title, item.completionId]), [["Pay rent", data.completions[1].id]]);
  const undone = undoCompletion(data, data.completions[1].id);
  assert.equal(undone.completions.length, 0);
  assert.equal(undone.tasks[0].completedAt, undefined);
  assert.deepEqual(dashboardDays(undone, today, 1, today)[0].due.map(task => task.title), ["Pay rent"]);
});

test("recurring occurrences keep separate completion history", () => {
  const data = withTask({ recurrence: { frequency: "daily", interval: 1, anchorDate: "2026-10-18", occurrences: 0 }, dueDate: "2026-10-18" });
  const first = completeTask(data, taskId, new Date("2026-10-20T08:00:00.000Z"));
  const second = completeTask(first, taskId, new Date("2026-10-20T08:01:00.000Z"));
  assert.equal(second.completions.length, 2);
  assert.notEqual(second.completions[0].id, second.completions[1].id);
});
