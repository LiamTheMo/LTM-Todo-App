import test from "node:test";
import assert from "node:assert/strict";
import { addDays, calendarGridDates, bulkCompleteTasks, bulkSetPriority, completeTask, createRoutine, dashboardDays, deleteSection, deleteScheduledBlock, emptyData, filterTasks, historyStart, instantiateTaskTemplate, localDate, newEntity, nextOccurrence, overdueTasks, pendingReminderTriggers, scheduledReminderTriggers, pruneExpiredHistory, reorderProject, reorderSection, reorderTask, restoreScheduledBlock, saveScheduledBlock, saveTask, saveTaskTemplate, setRoutineEnabled, taskDueDateOrder, undoCompletion } from "../lib/domain.ts";

const task = (id, dueDate, extras = {}) => ({
  id, title: id, notes: "", priority: "low", tagIds: [], sortKey: 1,
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", revision: 1,
  dueDate, ...extras
});
test("date-only arithmetic preserves calendar dates across DST", () => {
  assert.equal(addDays("2026-03-08", 1), "2026-03-09");
  assert.equal(addDays("2026-11-01", -1), "2026-10-31");
});
test("task due-date ordering puts nearest dates first and leaves undated tasks last", () => {
  const tasks = [
    task("undated", undefined, { sortKey: 0 }),
    task("later", "2026-10-08", { sortKey: 0 }),
    task("today-later-in-order", "2026-10-05", { sortKey: 2 }),
    task("past", "2026-10-04", { sortKey: 0 }),
    task("today-first-in-order", "2026-10-05", { sortKey: 1 })
  ];
  assert.deepEqual([...tasks].sort(taskDueDateOrder).map(item => item.id), [
    "past", "today-first-in-order", "today-later-in-order", "later", "undated"
  ]);
});
test("calendar month grid contains six Sunday-first weeks across month boundaries", () => {
  const january = calendarGridDates("2026-01");
  assert.equal(january.length, 42);
  assert.equal(january[0], "2025-12-28");
  assert.equal(january.at(-1), "2026-02-07");
  assert.equal(calendarGridDates("2026-03")[0], "2026-03-01");
});
test("scheduled work and due date stay in separate Dashboard groups", () => {
  const data = emptyData();
  data.tasks.push(task("one", "2026-10-05"));
  data.blocks.push({
    id: "block", taskId: "one", startInstant: "2026-10-03T16:00:00Z",
    endInstant: "2026-10-03T17:00:00Z", timeZone: "America/Edmonton",
    createdAt: "", updatedAt: "", revision: 1
  });
  const days = dashboardDays(data, "2026-10-03", 3, "2026-10-03");
  assert.equal(days[0].scheduled[0].task.id, "one");
  assert.equal(days[2].due[0].id, "one");
  assert.equal(data.tasks[0].dueDate, "2026-10-05");
});
test("Dashboard keeps a completed task occurrence on its due date", () => {
  const data = emptyData();
  data.tasks.push(task("finished", "2026-10-05"));
  const checkedOff = completeTask(data, "finished", new Date("2026-10-04T12:00:00Z"));
  const days = dashboardDays(checkedOff, "2026-10-04", 2, "2026-10-05");
  assert.deepEqual(days[0].completed, []);
  assert.deepEqual(days[1].completed.map(item => [item.task.id, item.completionId]), [["finished", checkedOff.completions[0].id]]);
  assert.deepEqual(days[1].due, []);
  assert.equal(checkedOff.tasks[0].dueDate, "2026-10-05");
});
test("past Dashboard dates show due tasks alongside completed scheduled tasks", () => {
  const data = emptyData();
  data.tasks.push(task("late", "2026-10-02"), task("finished", "2026-10-02", { completedAt: "2026-10-03T12:00:00Z" }));
  data.blocks.push(
    { id: "late-block", taskId: "late", startInstant: "2026-10-02T15:00:00Z", endInstant: "2026-10-02T16:00:00Z", timeZone: "UTC", createdAt: "", updatedAt: "", revision: 1 },
    { id: "finished-block", taskId: "finished", startInstant: "2026-10-02T16:00:00Z", endInstant: "2026-10-02T17:00:00Z", timeZone: "UTC", createdAt: "", updatedAt: "", revision: 1 }
  );
  const [day] = dashboardDays(data, "2026-10-02", 1, "2026-10-04");
  assert.deepEqual(day.due.map(item => item.id), ["late"]);
  assert.deepEqual(day.scheduled.map(item => [item.task.id, item.completed]), [["finished", true]]);
  assert.deepEqual(day.completed.map(item => item.task.id), []);
});
test("recurring completion history appears on the original occurrence date", () => {
  const data = emptyData();
  data.tasks.push(task("repeat", "2026-10-03", { recurrence: { frequency: "weekly", interval: 1, anchorDate: "2026-10-03", occurrences: 0 } }));
  const completed = completeTask(data, "repeat", new Date("2026-10-05T09:00:00Z"));
  assert.equal(completed.tasks[0].dueDate, "2026-10-10");
  const days = dashboardDays(completed, "2026-10-03", 3, "2026-10-06");
  const [day] = days;
  assert.deepEqual(day.completed.map(item => [item.task.id, item.completionId]), [["repeat", completed.completions[0].id]]);
  assert.deepEqual(days[2].completed, []);
});
test("legacy completed tasks with a due date stay on that date", () => {
  const data = emptyData();
  data.tasks.push(task("legacy", "2026-10-03", { completedAt: "2026-10-05T09:00:00Z" }));
  const days = dashboardDays(data, "2026-10-03", 3, "2026-10-06");
  assert.deepEqual(days[0].completed.map(item => item.task.id), ["legacy"]);
  assert.deepEqual(days[2].completed, []);
});
test("a completed scheduled occurrence is not duplicated in the same day's completion group", () => {
  const data = emptyData();
  data.tasks.push(task("finished", "2026-10-03", { completedAt: "2026-10-03T09:00:00Z" }));
  data.blocks.push({ id: "finished-block", taskId: "finished", startInstant: "2026-10-03T08:00:00Z",
    endInstant: "2026-10-03T09:00:00Z", timeZone: "UTC", createdAt: "", updatedAt: "", revision: 1 });
  data.completions.push({ id: "finished-occurrence", taskId: "finished", occurrenceDate: "2026-10-03", completedAt: "2026-10-03T09:00:00Z" });
  const [day] = dashboardDays(data, "2026-10-03", 1, "2026-10-04");
  assert.equal(day.scheduled[0].completed, true);
  assert.deepEqual(day.completed, []);
});
test("overdue includes recent unfinished deadlines and ignores older dates and scheduled events", () => {
  const data = emptyData();
  data.projects.push({ id: "archived", name: "Archived", color: "#fff", sortKey: 0, createdAt: "", updatedAt: "", revision: 1,
    archivedAt: "2026-09-01T00:00:00Z" });
  data.tasks.push(task("oldest", "2026-08-29"), task("newer", "2026-09-28"), task("boundary", "2026-08-30"), task("today", "2026-09-29"),
    task("future", "2026-10-01"), task("done", "2026-09-10", { completedAt: "2026-09-10T12:00:00Z" }),
    task("archived", "2026-09-10", { projectId: "archived" }), task("event", undefined));
  data.blocks.push({ id: "event-block", taskId: "event", startInstant: "2026-09-20T15:00:00Z",
    endInstant: "2026-09-20T16:00:00Z", timeZone: "America/Edmonton", createdAt: "", updatedAt: "", revision: 1 });
  assert.deepEqual(overdueTasks(data, "2026-09-29").map(item => item.id), ["boundary", "newer"]);
});
test("an overdue task stays on its due date and also appears in Overdue", () => {
  const data = emptyData();
  const created = saveTask(data, task("past-added", "2026-09-28"), "", "2026-09-29");
  const [pastDay] = dashboardDays(created, "2026-09-28", 1, "2026-09-29");
  assert.deepEqual(overdueTasks(created, "2026-09-29").map(item => item.id), ["past-added"]);
  assert.deepEqual(pastDay.due.map(item => item.id), ["past-added"]);
});
test("history retention keeps 31 calendar days and removes expired task and event data", () => {
  const today = "2026-10-01";
  assert.equal(historyStart(today), "2026-09-01");
  const data = emptyData();
  data.tasks.push(
    task("expired", "2026-08-31"),
    task("boundary", "2026-09-01"),
    task("old-completed", undefined, { completedAt: "2026-08-31T12:00:00Z" }),
    task("open-undated", undefined),
    task("future", "2026-10-02")
  );
  data.blocks.push(
    { id: "expired-block", taskId: "boundary", startInstant: "2026-08-31T15:00:00Z", endInstant: "2026-08-31T16:00:00Z", timeZone: "UTC", createdAt: "", updatedAt: "", revision: 1 },
    { id: "retained-block", taskId: "boundary", startInstant: "2026-09-01T15:00:00Z", endInstant: "2026-09-01T16:00:00Z", timeZone: "UTC", createdAt: "", updatedAt: "", revision: 1 }
  );
  data.reminders.push(
    { id: "expired-reminder", taskId: "expired", minutesBefore: 0, enabled: true, createdAt: "", updatedAt: "", revision: 1 },
    { id: "retained-reminder", taskId: "boundary", minutesBefore: 0, enabled: true, createdAt: "", updatedAt: "", revision: 1 }
  );
  data.completions.push(
    { id: "expired-completion", taskId: "boundary", occurrenceDate: "2026-08-31", completedAt: "2026-08-31T16:00:00Z" },
    { id: "retained-completion", taskId: "boundary", occurrenceDate: "2026-09-01", completedAt: "2026-09-01T16:00:00Z" }
  );
  const retained = pruneExpiredHistory(data, today);
  assert.deepEqual(retained.tasks.map(item => item.id), ["boundary", "open-undated", "future"]);
  assert.deepEqual(retained.blocks.map(item => item.id), ["retained-block"]);
  assert.deepEqual(retained.reminders.map(item => item.id), ["retained-reminder"]);
  assert.deepEqual(retained.completions.map(item => item.id), ["retained-completion"]);
});
test("task editor domain guard rejects a due date outside the retained month", () => {
  const data = emptyData();
  assert.equal(saveTask(data, task("too-old", "2026-08-31"), "", "2026-10-01"), data);
});
test("task edits without work-time fields preserve existing scheduled data", () => {
  const data = emptyData();
  const existing = task("planned", "2026-10-01");
  const block = { id: "block", taskId: existing.id, startInstant: "2026-09-29T15:00:00Z",
    endInstant: "2026-09-29T16:00:00Z", timeZone: "America/Edmonton", createdAt: "", updatedAt: "", revision: 1 };
  data.tasks.push(existing);
  data.blocks.push(block);
  const edited = saveTask(data, { ...existing, title: "Edited title", revision: existing.revision + 1 });
  assert.deepEqual(edited.blocks, [block]);
  assert.equal(edited.tasks[0].title, "Edited title");
});
test("scheduling, moving, unscheduling, and undo leave task due fields unchanged", () => {
  const due = { dueDate: "2026-10-14", dueTime: "17:30", dueTimeZone: "America/Edmonton" };
  const data = { ...emptyData(), tasks: [task("schedule-me", due.dueDate, due)] };
  const block = { id: "block-1", taskId: "schedule-me", startInstant: "2026-10-14T15:00:00Z", endInstant: "2026-10-14T16:00:00Z", timeZone: "America/Edmonton", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", revision: 1 };
  const scheduled = saveScheduledBlock(data, block);
  assert.equal(scheduled.tasks[0].dueDate, due.dueDate);
  assert.equal(scheduled.tasks[0].dueTime, due.dueTime);
  const moved = saveScheduledBlock(scheduled, { ...block, startInstant: "2026-10-15T15:00:00Z", endInstant: "2026-10-15T16:30:00Z" });
  assert.equal(moved.tasks[0].dueDate, due.dueDate);
  assert.equal(moved.tasks[0].dueTime, due.dueTime);
  const unscheduled = deleteScheduledBlock(moved, block.id);
  assert.ok(unscheduled.blocks[0].deletedAt);
  const undone = restoreScheduledBlock(unscheduled, moved.blocks[0]);
  assert.equal(undone.blocks[0].deletedAt, undefined);
  assert.equal(undone.blocks[0].startInstant, "2026-10-15T15:00:00Z");
  assert.equal(undone.tasks[0].dueDate, due.dueDate);
  assert.equal(saveScheduledBlock(data, { ...block, timeZone: "Not/AZone" }), data);
});
test("templates create fresh task identities and routines carry their recurrence", () => {
  const initial = emptyData();
  const template = { ...newEntity(), name: "Weekly review", title: "Review goals", notes: "", priority: "medium", tagIds: [] };
  const withTemplate = saveTaskTemplate(initial, template);
  const due = localDate(new Date());
  const once = instantiateTaskTemplate(withTemplate, template.id, due);
  const twice = instantiateTaskTemplate(once, template.id, due);
  const first = twice.tasks[0];
  const second = twice.tasks[1];
  assert.notEqual(first.id, second.id);
  assert.equal(first.title, "Review goals");
  const withRoutine = createRoutine(twice, template.id, "Weekly review", due, { frequency: "weekly", interval: 1, weekdays: [1] });
  const routine = withRoutine.routines[0];
  const routineTask = withRoutine.tasks.find(item => item.id === routine.taskId);
  assert.equal(routineTask.recurrence.frequency, "weekly");
  assert.equal(routineTask.recurrence.anchorDate, due);
  const progressed = { ...withRoutine, tasks: withRoutine.tasks.map(item => item.id === routine.taskId ? { ...item, recurrence: { ...item.recurrence, occurrences: 3 } } : item) };
  const paused = setRoutineEnabled(progressed, routine.id, false);
  assert.equal(paused.tasks.find(item => item.id === routine.taskId).recurrence, undefined);
  assert.equal(paused.routines[0].recurrence.occurrences, 3);
  assert.equal(setRoutineEnabled(paused, routine.id, true).tasks.find(item => item.id === routine.taskId).recurrence.occurrences, 3);
});
test("bulk priority edits update selected open tasks atomically", () => {
  const data = { ...emptyData(), tasks: [task("one", undefined), task("two", undefined), { ...task("done", undefined), completedAt: "2026-10-01T00:00:00Z" }] };
  const updated = bulkSetPriority(data, ["one", "done"], "high");
  assert.equal(updated.tasks.find(item => item.id === "one").priority, "high");
  assert.equal(updated.tasks.find(item => item.id === "done").priority, "low");
  assert.equal(updated.tasks.find(item => item.id === "two").priority, "low");
});
test("84-day Dashboard date windows stay bounded and large local lists remain responsive", () => {
  const data = emptyData();
  for (let index = 0; index < 5000; index++) {
    data.tasks.push(task(String(index), addDays("2026-10-01", index % 56), { sortKey: index }));
  }
  const start = performance.now();
  const days = dashboardDays(data, "2026-10-01", 84);
  assert.equal(days.length, 84);
  assert.equal(days.reduce((count, day) => count + day.due.length, 0), 5000);
  assert.ok(performance.now() - start < 2500, "84-day query should finish within 2.5 seconds for 5,000 tasks");
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
test("bulk completion completes each selected task once without relationship ordering", () => {
  const data = emptyData();
  data.tasks.push(task("one", undefined), task("two", undefined));
  const done = bulkCompleteTasks(data, ["one", "two", "one"], new Date("2026-10-01T12:00:00Z"));
  assert.equal(done.completions.length, 2);
  assert.ok(done.tasks.every(item => item.completedAt));
});
test("web reminder triggers are bounded, ordered, and ignore completed or disabled items", () => {
  const data = emptyData();
  const due = task("due", "2026-10-01", { dueTime: "13:00", dueTimeZone: "UTC" });
  const edmonton = task("edmonton", "2026-10-01", { dueTime: "13:00", dueTimeZone: "America/Edmonton" });
  const complete = task("complete", "2026-10-01", { dueTime: "13:00", completedAt: "2026-09-30T12:00:00Z" });
  data.tasks.push(due, edmonton, complete);
  data.reminders.push(
    { id: "a", taskId: "due", minutesBefore: 15, enabled: true, createdAt: "", updatedAt: "", revision: 1 },
    { id: "edmonton", taskId: "edmonton", minutesBefore: 0, enabled: true, createdAt: "", updatedAt: "", revision: 1 },
    { id: "b", taskId: "complete", minutesBefore: 0, enabled: true, createdAt: "", updatedAt: "", revision: 1 },
    { id: "c", taskId: "due", minutesBefore: 0, enabled: false, createdAt: "", updatedAt: "", revision: 1 }
  );
  const results = pendingReminderTriggers(data, Date.parse("2026-10-01T12:00:00Z"));
  assert.deepEqual(results.map(item => item.reminder.id), ["a", "edmonton"]);
  assert.equal(results[0].triggerAt, Date.parse("2026-10-01T12:45:00Z"));
  assert.equal(results[1].triggerAt, Date.parse("2026-10-01T19:00:00Z"));
});
test("push reminder schedule includes future items beyond the foreground timer horizon", () => {
  const data = emptyData();
  const now = Date.parse("2026-10-01T12:00:00Z");
  data.tasks.push(task("near", "2026-10-03", { dueTime: "09:00", dueTimeZone: "UTC" }),
    task("far", "2027-01-01", { dueTime: "09:00", dueTimeZone: "UTC" }),
    task("completed", "2027-01-02", { dueTime: "09:00", dueTimeZone: "UTC", completedAt: "2026-09-30T12:00:00Z" }));
  data.reminders.push(
    { id: "near", taskId: "near", minutesBefore: 15, enabled: true, createdAt: "", updatedAt: "", revision: 1 },
    { id: "far", taskId: "far", minutesBefore: 0, enabled: true, createdAt: "", updatedAt: "", revision: 1 },
    { id: "completed", taskId: "completed", minutesBefore: 0, enabled: true, createdAt: "", updatedAt: "", revision: 1 }
  );
  assert.deepEqual(pendingReminderTriggers(data, now).map(item => item.reminder.id), ["near"]);
  assert.deepEqual(scheduledReminderTriggers(data, now).map(item => item.reminder.id), ["near", "far"]);
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
test("archived project tasks leave active search and Dashboard, then return on restore", () => {
  const data = emptyData();
  data.projects.push({ id: "p", name: "Paused", color: "#fff", sortKey: 0, createdAt: "", updatedAt: "", revision: 1,
    archivedAt: "2026-09-01T00:00:00Z" });
  data.tasks.push(task("archived", "2026-10-05", { projectId: "p" }), task("inbox", "2026-10-05"));
  assert.deepEqual(filterTasks(data, { completed: false }).map(item => item.id), ["inbox"]);
  assert.deepEqual(dashboardDays(data, "2026-10-05", 1)[0].due.map(item => item.id), ["inbox"]);
  data.projects[0].archivedAt = undefined;
  assert.deepEqual(filterTasks(data, { completed: false }).map(item => item.id), ["archived", "inbox"]);
  assert.deepEqual(dashboardDays(data, "2026-10-05", 1)[0].due.map(item => item.id), ["archived", "inbox"]);
});
test("project and section moves persist ordering, respect boundaries and isolate groups", () => {
  const data = emptyData();
  const entity = (id, extras = {}) => ({ id, name: id, sortKey: 0, createdAt: "", updatedAt: "", revision: 1, ...extras });
  data.projects.push(entity("a", { color: "#fff" }), entity("b", { color: "#fff" }),
    entity("archived", { color: "#fff", archivedAt: "2026-09-01T00:00:00Z" }));
  data.sections.push(entity("one", { projectId: "a" }), entity("two", { projectId: "a" }),
    entity("other", { projectId: "b" }));
  const reordered = reorderSection(reorderProject(data, "b", -1), "two", -1);
  assert.deepEqual(reordered.projects.filter(p => !p.archivedAt).sort((a, b) => a.sortKey - b.sortKey).map(p => p.id), ["b", "a"]);
  assert.deepEqual(reordered.sections.filter(s => s.projectId === "a").sort((a, b) => a.sortKey - b.sortKey).map(s => s.id), ["two", "one"]);
  assert.deepEqual(reordered.sections.filter(s => s.projectId === "b"), data.sections.filter(s => s.projectId === "b"));
  assert.deepEqual(reorderProject(reordered, "b", -1), reordered);
  assert.deepEqual(reorderSection(reordered, "two", -1), reordered);
  assert.deepEqual(reorderProject(reordered, "archived", -1), reordered);
  assert.equal(reordered.projects.find(p => p.id === "b").revision, 2);
  assert.equal(reordered.projects.find(p => p.id === "a").revision, 1);
  assert.equal(reordered.sections.find(s => s.id === "two").revision, 2);
  assert.equal(reordered.sections.find(s => s.id === "one").revision, 1);
});
test("global structured filters combine status, project, tag, priority and date without stale indexes", () => {
  const data = emptyData();
  data.tasks.push(task("overdue", "2026-09-28", { notes: "Review draft", priority: "high", tagIds: ["work"], projectId: "p" }),
    task("today", "2026-09-29", { projectId: "p" }), task("future", "2026-10-01", { projectId: "p" }),
    task("done", "2026-09-28", { projectId: "p", completedAt: "2026-09-28T18:00:00Z" }),
    task("inbox", undefined));
  const today = "2026-09-29";
  assert.deepEqual(filterTasks(data, { query: "draft", projectId: "p", tagId: "work", priority: "high",
    completed: false, dateScope: "overdue", today }).map(item => item.id), ["overdue"]);
  assert.deepEqual(filterTasks(data, { completed: true, dateScope: "overdue", today }).map(item => item.id), ["done"]);
  assert.deepEqual(filterTasks(data, { projectId: null, dateScope: "undated", today }).map(item => item.id), ["inbox"]);
  assert.deepEqual(filterTasks(data, { dateScope: "today", today }).map(item => item.id), ["today"]);
  assert.deepEqual(filterTasks(data, { dateScope: "upcoming", today }).map(item => item.id), ["future"]);
});
test("dense section sort keys rebalance only their project group", () => {
  const data = emptyData();
  const entity = (id, projectId) => ({ id, projectId, name: id, sortKey: 0, createdAt: "", updatedAt: "", revision: 1 });
  data.sections.push(entity("a", "p"), entity("b", "p"), entity("c", "p"), entity("other", "q"));
  const moved = reorderSection(data, "c", -1);
  assert.deepEqual(moved.sections.filter(s => s.projectId === "p").sort((a, b) => a.sortKey - b.sortKey).map(s => s.id), ["a", "c", "b"]);
  assert.deepEqual(moved.sections.find(s => s.id === "other"), data.sections.find(s => s.id === "other"));
});
