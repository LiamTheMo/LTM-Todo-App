import test from "node:test";
import assert from "node:assert/strict";
import { defaultWeekdaysForRepeat, recurrenceForRepeat, repeatLabelFor, repeatOptionsFor, repeatSelectionFor, repeatUsesWeekdayPicker } from "../lib/recurrence-presets.ts";

test("repeat presets map to the intended structured recurrence", () => {
  assert.deepEqual(recurrenceForRepeat("daily", []), { frequency: "daily", interval: 1, weekdays: undefined });
  assert.deepEqual(recurrenceForRepeat("every-other-day", []), { frequency: "daily", interval: 2, weekdays: undefined });
  assert.deepEqual(recurrenceForRepeat("weekdays", []), { frequency: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] });
  assert.deepEqual(recurrenceForRepeat("weekends", []), { frequency: "weekly", interval: 1, weekdays: [0, 6] });
  assert.deepEqual(recurrenceForRepeat("weekly", [4, 2]), { frequency: "weekly", interval: 1, weekdays: [2, 4] });
  assert.deepEqual(recurrenceForRepeat("biweekly", []), { frequency: "weekly", interval: 2, weekdays: undefined });
  assert.deepEqual(recurrenceForRepeat("monthly", []), { frequency: "monthly", interval: 1, weekdays: undefined });
  assert.deepEqual(recurrenceForRepeat("every-two-months", []), { frequency: "monthly", interval: 2, weekdays: undefined });
  assert.deepEqual(recurrenceForRepeat("quarterly", []), { frequency: "monthly", interval: 3, weekdays: undefined });
  assert.deepEqual(recurrenceForRepeat("yearly", []), { frequency: "yearly", interval: 1, weekdays: undefined });
  assert.equal(recurrenceForRepeat("", []), undefined);
});

test("repeat presets restore standard schedules and preserve custom saved intervals", () => {
  assert.equal(repeatSelectionFor({ frequency: "weekly", interval: 2 }), "biweekly");
  assert.equal(repeatSelectionFor({ frequency: "weekly", interval: 1, weekdays: [5, 2, 4, 1, 3] }), "weekdays");
  assert.equal(repeatSelectionFor({ frequency: "weekly", interval: 1, weekdays: [6, 0] }), "weekends");

  const custom = { frequency: "monthly", interval: 4 };
  const selection = repeatSelectionFor(custom);
  assert.equal(selection, "custom:monthly:4");
  assert.deepEqual(recurrenceForRepeat(selection, []), { frequency: "monthly", interval: 4, weekdays: undefined });
  assert.ok(repeatOptionsFor(custom).some(option => option.value === selection && option.label === "Custom · every 4 months"));
  assert.equal(repeatLabelFor({ frequency: "weekly", interval: 2 }), "Biweekly (every 2 weeks)");
});

test("weekday presets set their days while weekly and biweekly retain optional day selection", () => {
  assert.deepEqual(defaultWeekdaysForRepeat("weekdays"), [1, 2, 3, 4, 5]);
  assert.deepEqual(defaultWeekdaysForRepeat("weekends"), [0, 6]);
  assert.equal(defaultWeekdaysForRepeat("weekly"), undefined);
  assert.equal(repeatUsesWeekdayPicker("weekly"), true);
  assert.equal(repeatUsesWeekdayPicker("biweekly"), true);
  assert.equal(repeatUsesWeekdayPicker("custom:weekly:4"), true);
  assert.equal(repeatUsesWeekdayPicker("weekdays"), false);
});
