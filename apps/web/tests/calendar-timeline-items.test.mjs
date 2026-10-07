import test from "node:test";
import assert from "node:assert/strict";
import { emptyData } from "../lib/domain.ts";
import { calendarTimelineItemsForDay } from "../lib/calendar-timeline-items.ts";

const stamp = "2026-10-07T12:00:00.000Z";
const task = (id, title, dueDate, dueTime) => ({ id, title, notes: "", priority: "low", tagIds: [], sortKey: 1,
  dueDate, dueTime, dueTimeZone: "UTC", createdAt: stamp, updatedAt: stamp, revision: 1 });

test("calendar timeline items match the selected day and exclude hidden calendars", () => {
  const data = emptyData();
  const day = "2026-10-08";
  const calendarId = data.calendars[0].id;
  const hiddenCalendar = { ...data.calendars[0], id: "00000000-0000-4000-8000-000000000002", name: "Hidden", visible: false };
  data.calendars.push(hiddenCalendar);
  data.calendarEvents.push(
    { id: "visible-event", calendarId, title: "Class", notes: "", allDay: false,
      startInstant: "2026-10-08T09:00:00.000Z", endInstant: "2026-10-08T10:00:00.000Z", timeZone: "UTC",
      createdAt: stamp, updatedAt: stamp, revision: 1 },
    { id: "hidden-event", calendarId: hiddenCalendar.id, title: "Hidden event", notes: "", allDay: false,
      startInstant: "2026-10-08T11:00:00.000Z", endInstant: "2026-10-08T12:00:00.000Z", timeZone: "UTC",
      createdAt: stamp, updatedAt: stamp, revision: 1 }
  );
  data.tasks.push(task("planned-task", "Study", undefined, undefined), task("deadline-task", "Submit paper", day, "13:00"));
  data.blocks.push({ id: "study-block", taskId: "planned-task", startInstant: "2026-10-08T10:00:00.000Z",
    endInstant: "2026-10-08T11:00:00.000Z", timeZone: "UTC", createdAt: stamp, updatedAt: stamp, revision: 1 });

  const items = calendarTimelineItemsForDay(data, day, "2026-10-07");
  assert.deepEqual(items.map(item => item.id), ["event:visible-event:2026-10-08", "block:study-block", "deadline:deadline-task"]);
  assert.deepEqual(items.map(item => item.title), ["Class", "Study", "Submit paper"]);
});
