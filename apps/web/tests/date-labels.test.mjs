import test from "node:test";
import assert from "node:assert/strict";
import { calendarDayDifference, dueTimeCaption, overdueDueCaption } from "../lib/date-labels.ts";

test("overdue captions use singular and plural calendar-day wording", () => {
  assert.equal(overdueDueCaption("2026-09-28", "2026-09-29"), "Due 1 day ago");
  assert.equal(overdueDueCaption("2026-09-23", "2026-09-29"), "Due 6 days ago");
});

test("overdue captions count calendar dates across daylight-saving changes", () => {
  assert.equal(calendarDayDifference("2026-03-07", "2026-03-09"), 2);
  assert.equal(overdueDueCaption("2026-03-08", "2026-03-09"), "Due 1 day ago");
});

test("due times use compact 12-hour captions including midnight and noon", () => {
  assert.equal(dueTimeCaption("00:05"), "12:05am");
  assert.equal(dueTimeCaption("09:15"), "9:15am");
  assert.equal(dueTimeCaption("12:00"), "12:00pm");
  assert.equal(dueTimeCaption("17:30"), "5:30pm");
  assert.equal(dueTimeCaption("25:70"), "25:70");
});
