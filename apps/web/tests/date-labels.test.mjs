import test from "node:test";
import assert from "node:assert/strict";
import { calendarDayDifference, overdueDueCaption } from "../lib/date-labels.ts";

test("overdue captions use singular and plural calendar-day wording", () => {
  assert.equal(overdueDueCaption("2026-09-28", "2026-09-29"), "Due 1 day ago");
  assert.equal(overdueDueCaption("2026-09-23", "2026-09-29"), "Due 6 days ago");
});

test("overdue captions count calendar dates across daylight-saving changes", () => {
  assert.equal(calendarDayDifference("2026-03-07", "2026-03-09"), 2);
  assert.equal(overdueDueCaption("2026-03-08", "2026-03-09"), "Due 1 day ago");
});
