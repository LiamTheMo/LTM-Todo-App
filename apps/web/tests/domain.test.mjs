import test from "node:test";
import assert from "node:assert/strict";
import { addDays, completeTask, dashboardDays, deleteSection, emptyData, filterTasks, nextOccurrence, reorderTask, undoCompletion } from "../lib/domain.ts";

const task = (id, dueDate, extras = {}) => ({
  id, title: id, notes: "", priority: "none", tagIds: [], sortKey: 1,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", revision: 1,
  dueDate, ...extras
});
test("date-only arithmetic preserves calendar dates across DST", () => {
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  assert.equal(addDays("2026-11-01", -1), "2026-10-31");
});
test("scheduled work and due date stay in separate Dashboard groups", () => {
  const data = emptyData();
  data.tasks.push(task("one", "2026-10-05"));
  data.blocks.push({
    id: "block", taskId: "one", startInstant: "2026-10-03T16:00:00Z",
    endInstant: "2026-10-03T17:00:00Z", timeZone: "America/Edmonton",
    createdAt: "", updatedAt: "", revision: 1
  });
  const days = dashboardDays(data, "2026-10-03", 3);
  assert.equal(days[0].scheduled[0].task.id, "one");
  assert.equal(days[2].due[0].id, "one");
  assert.equal(data.tasks[0].dueDate, "2026-10-05");
});
test("Dashboard keeps same-day scheduling distinct and excludes completed work", () => {
  const data = emptyData();
  data.tasks.push(task("both", "2026-10-05"), task("finished", "2026-10-05", { completedAt: "2026-10-04T12:00:00Z" }));
  data.blocks.push({ id: "block", taskId: "both", startInstant: "2026-10-05T15:00:00Z",
    endInstant: "2026-10-05T16:00:00Z", timeZone: "America/Edmonton", createdAt: "", updatedAt: "", revision: 1 });
  const [day] = dashboardDays(data, "2026-10-05", 1);
  assert.deepEqual(day.scheduled.map(item => item.task.id), ["both"]);
  assert.deepEqual(day.due.map(item => item.id), ["both"]);
});
test("Dashboard date windows stay bounded and large local lists remain responsive", () => {
  const data = emptyData();
  for (let index = 0; index < 5000; index++) {
    data.tasks.push(task(String(index), addDays("2026-10-01", index % 56), { sortKey: index }));
  }
  const start = performance.now();
  const days = dashboardDays(data, "2026-10-01", 56);
  assert.equal(days.length, 56);
  assert.equal(days.reduce((count, day) => count + day.due.length, 0), 5000);
  assert.ok(performance.now() - start < 2500, "56-day query should finish within 2.5 seconds for 5,000 tasks");
});
test("recurrence anchors monthly dates and records each completed occurrence", () => {
  const recurrence = { frequency: "monthly", interval: 1, anchorDate: "2026-01-31", occurrences: 0 };
  assert.equal(nextOccurrence(recurrence, "2026-01-31"), "2026-02-28");
  assert.equal(nextOccurrence(recurrence, "2026-02-28"), "2026-03-31");
  const data = emptyData();
  data.tasks.push(task("repeat", "2026-01-31", { recurrence }));
  const first = completeTask(data, "repeat", new Date("2026-01-31T18:00:00Z"));
  const second = completeTask(first, "repeat", new Date("2026-02-28T18:00:00Z"));
  assert.equal(second.tasks[0].dueDate, "2026-03-31");
  assert.deepEqual(second.completions.map(item => item.occurrenceDate), ["2026-01-31", "2026-02-28"]);
  const undone = undoCompletion(second, second.completions.at(-1).id);
  assert.equal(undone.tasks[0].dueDate, "2026-02-28");
  assert.equal(undone.completions.length, 1);
});
test("weekly weekday selections respect interval and a distant future date", () => {
  const rule = { frequency: "weekly", interval: 2, anchorDate: "2026-01-05", weekdays: [1, 3], occurrences: 0 };
  assert.equal(nextOccurrence(rule, "2026-01-05"), "2026-01-07");
  assert.equal(nextOccurrence(rule, "2026-01-07"), "2026-01-19");
  assert.equal(nextOccurrence(rule, "2040-01-04"), "2040-01-16");
});
test("recurrence end conditions stop after a count or calendar date", () => {
  const rule = { frequency: "daily", interval: 1, anchorDate: "2026-03-07", occurrences: 0, count: 2 };
  const data = emptyData();
  data.tasks.push(task("repeat", "2026-03-07", { recurrence: rule }));
  const first = completeTask(data, "repeat", new Date("2026-03-07T18:00:00Z"));
  assert.equal(first.tasks[0].dueDate, "2026-03-08");
  const second = completeTask(first, "repeat", new Date("2026-03-08T18:00:00Z"));
  assert.equal(second.tasks[0].completedAt, "2026-03-08T18:00:00.000Z");
  assert.equal(completeTask(second, "repeat").completions.length, 2);
  assert.equal(nextOccurrence({ ...rule, count: undefined, until: "2026-03-08" }, "2026-03-08"), undefined);
  assert.equal(nextOccurrence({ ...rule, count: undefined }, "2040-01-01"), "2040-01-02");
  assert.equal(nextOccurrence({ frequency: "yearly", interval: 1, anchorDate: "2024-02-29", occurrences: 0 }, "2025-02-28"), "2026-02-28");
});
test("completed and deleted records leave active search", () => {
  const data = emptyData();
  data.tasks.push(task("alpha", "2026-10-01", { notes: "Read chapter", tagIds: ["school"] }));
  data.tasks.push(task("beta", undefined, { completedAt: "2026-10-01T10:00:00Z" }));
  data.tasks.push(task("gamma", undefined, { deletedAt: "2026-10-01T10:00:00Z" }));
  assert.deepEqual(filterTasks(data, { query: "chapter", tagId: "school", completed: false }).map(item => item.id), ["alpha"]);
  assert.deepEqual(filterTasks(data, { completed: true }).map(item => item.id), ["beta"]);
});
test("parent completion waits for unfinished subtasks", () => {
  const data = emptyData();
  data.tasks.push(task("parent", "2026-10-01"), task("child", undefined, { parentTaskId: "parent" }));
  assert.equal(completeTask(data, "parent").completions.length, 0);
  const childDone = completeTask(data, "child");
  assert.equal(completeTask(childDone, "parent").completions.length, 2);
});
test("reorder retains identity and section deletion moves tasks to project root", () => {
  const data = emptyData();
  data.tasks.push(task("a", undefined, { projectId: "p", sectionId: "s", sortKey: 1024 }), task("b", undefined, { projectId: "p", sectionId: "s", sortKey: 2048 }));
  data.sections.push({ id: "s", projectId: "p", name: "First", sortKey: 0, createdAt: "", updatedAt: "", revision: 1 });
  const moved = reorderTask(data, "b", -1);
  assert.deepEqual(filterTasks(moved, { projectId: "p" }).map(item => item.id), ["b", "a"]);
  const deleted = deleteSection(moved, "s");
  assert.equal(deleted.sections[0].deletedAt !== undefined, true);
  assert.equal(deleted.tasks[0].sectionId, undefined);
  assert.equal(deleted.tasks[0].id, "a");
});
