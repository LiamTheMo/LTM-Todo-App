import test from "node:test";
import assert from "node:assert/strict";
import { availableWorkSlots } from "../lib/schedule-slots.ts";

test("available work slots skip appointments and allow a slot that starts when one ends", () => {
  const slots = availableWorkSlots("2026-10-06", "America/Edmonton", [
    { startInstant: "2026-10-06T15:00:00.000Z", endInstant: "2026-10-06T16:00:00.000Z" }
  ], 60, Date.parse("2026-10-06T12:00:00.000Z"));

  assert.equal(slots.some(slot => slot.startInstant === "2026-10-06T14:30:00.000Z"), false);
  assert.equal(slots.some(slot => slot.startInstant === "2026-10-06T15:00:00.000Z"), false);
  assert.equal(slots.some(slot => slot.startInstant === "2026-10-06T16:00:00.000Z"), true);
});

test("today's earlier slots are omitted and future days remain bookable", () => {
  const now = Date.parse("2026-10-06T16:15:00.000Z");
  const todaySlots = availableWorkSlots("2026-10-06", "America/Edmonton", [], 60, now);
  const tomorrowSlots = availableWorkSlots("2026-10-07", "America/Edmonton", [], 60, now);

  assert.equal(todaySlots.every(slot => Date.parse(slot.startInstant) >= now), true);
  assert.equal(tomorrowSlots.length > 0, true);
});

test("slot generation handles daylight-saving gaps without duplicate starts", () => {
  const slots = availableWorkSlots("2026-03-08", "America/Edmonton", [], 60, Date.parse("2026-03-08T00:00:00.000Z"));
  const starts = slots.map(slot => slot.startInstant);
  assert.equal(new Set(starts).size, starts.length);
  assert.equal(starts.every(start => Number.isFinite(Date.parse(start))), true);
});

test("invalid durations and busy intervals do not create malformed slots", () => {
  assert.deepEqual(availableWorkSlots("2026-10-06", "America/Edmonton", [], 0), []);
  const slots = availableWorkSlots("2026-10-06", "America/Edmonton", [
    { startInstant: "invalid", endInstant: "also invalid" },
    { startInstant: "2026-10-06T16:00:00.000Z", endInstant: "2026-10-06T15:00:00.000Z" }
  ], 30, Date.parse("2026-10-06T12:00:00.000Z"));
  assert.equal(slots.length > 0, true);
  assert.equal(slots.every(slot => Date.parse(slot.endInstant) - Date.parse(slot.startInstant) === 30 * 60_000), true);
});
