import test from "node:test";
import assert from "node:assert/strict";
import { parseIcsCalendar } from "../lib/ics-calendar.ts";
import { toReadOnlyCalendarEvent } from "../lib/ics-calendar-view.ts";

const fixture = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//LTM//Feed Test//EN
BEGIN:VEVENT
UID:daily@example.test
DTSTART:20261003T100000Z
DTEND:20261003T103000Z
SUMMARY:Daily planning
RRULE:FREQ=DAILY;COUNT=4
END:VEVENT
BEGIN:VEVENT
UID:all-day@example.test
DTSTART;VALUE=DATE:20261004
DTEND;VALUE=DATE:20261005
SUMMARY:Company holiday
END:VEVENT
BEGIN:VEVENT
UID:cancelled@example.test
DTSTART:20261004T100000Z
DTEND:20261004T110000Z
SUMMARY:Cancelled
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

test("parses bounded read-only events, expands recurrence, and preserves exclusive all-day dates", () => {
  const events = parseIcsCalendar(fixture, new Date("2026-10-03T00:00:00Z"), new Date("2026-10-08T00:00:00Z"));
  const daily = events.filter(item => item.uid === "daily@example.test");
  assert.equal(daily.length, 4);
  assert.deepEqual(daily.map(item => item.start), ["2026-10-03T10:00:00.000Z", "2026-10-04T10:00:00.000Z",
    "2026-10-05T10:00:00.000Z", "2026-10-06T10:00:00.000Z"]);
  const allDay = events.find(item => item.uid === "all-day@example.test");
  assert.equal(allDay.start, "2026-10-04");
  assert.equal(allDay.end, "2026-10-05");
  assert.equal(allDay.allDay, true);
  assert.equal(events.some(item => item.uid === "cancelled@example.test"), false);
});

test("rejects malformed, oversized, and unbounded date windows", () => {
  assert.throws(() => parseIcsCalendar("BEGIN:VCALENDAR", new Date("2026-01-01"), new Date("2026-01-02")), /could not be parsed|iCalendar 2.0/);
  assert.throws(() => parseIcsCalendar("x".repeat(512_001), new Date("2026-01-01"), new Date("2026-01-02")), /512 KB/);
  assert.throws(() => parseIcsCalendar(fixture, new Date("2026-01-01"), new Date("2027-01-01")), /too large/);
});

test("preserves the event timezone while expanding recurring instances", () => {
  const source = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//LTM//Timezone Test//EN
BEGIN:VTIMEZONE
TZID:America/Los_Angeles
BEGIN:DAYLIGHT
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
TZNAME:PDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
TZNAME:PST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE
BEGIN:VEVENT
UID:weekly@example.test
DTSTART;TZID=America/Los_Angeles:20261003T100000
DTEND;TZID=America/Los_Angeles:20261003T110000
SUMMARY:West coast planning
RRULE:FREQ=DAILY;COUNT=2
END:VEVENT
END:VCALENDAR`;
  const events = parseIcsCalendar(source, new Date("2026-10-03T16:00:00Z"), new Date("2026-10-05T18:00:00Z"));
  assert.deepEqual(events.map(item => item.start), ["2026-10-03T17:00:00.000Z", "2026-10-04T17:00:00.000Z"]);
});

test("keeps moved recurrence exceptions in range and applies cancelled overrides", () => {
  const source = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//LTM//Recurrence Exception Test//EN
BEGIN:VEVENT
UID:moved@example.test
DTSTART:20261001T100000Z
DTEND:20261001T110000Z
SUMMARY:Planning
RRULE:FREQ=DAILY;COUNT=5
END:VEVENT
BEGIN:VEVENT
UID:moved@example.test
RECURRENCE-ID:20261001T100000Z
DTSTART:20261003T120000Z
DTEND:20261003T130000Z
SUMMARY:Moved planning
END:VEVENT
BEGIN:VEVENT
UID:cancelled-occurrence@example.test
DTSTART:20261003T090000Z
DTEND:20261003T093000Z
SUMMARY:Daily check-in
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
BEGIN:VEVENT
UID:cancelled-occurrence@example.test
RECURRENCE-ID:20261004T090000Z
DTSTART:20261004T090000Z
DTEND:20261004T093000Z
SUMMARY:Daily check-in
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;
  const events = parseIcsCalendar(source, new Date("2026-10-03T00:00:00Z"), new Date("2026-10-06T00:00:00Z"));
  const moved = events.filter(item => item.uid === "moved@example.test");
  assert.equal(moved.length, 4);
  const exception = moved.find(item => item.title === "Moved planning");
  assert.equal(exception.start, "2026-10-03T12:00:00.000Z");
  assert.equal(exception.recurrenceId, "2026-10-01T10:00:00Z");
  const daily = events.filter(item => item.uid === "cancelled-occurrence@example.test");
  assert.deepEqual(daily.map(item => item.start), ["2026-10-03T09:00:00.000Z", "2026-10-05T09:00:00.000Z"]);
});

test("read-only calendar projection preserves stable feed identity and all-day date semantics", () => {
  const subscription = { subscriptionId: "4ca47ed9-e14e-4af0-9c25-bb4b31e94bd6", calendarId: "c6bdc816-eebc-47b8-8f91-6be5619b06b1", visible: true };
  const imported = { uid: "holiday@example.test", recurrenceId: "2026-10-04", title: "Holiday", start: "2026-10-04", end: "2026-10-06", allDay: true };
  const first = toReadOnlyCalendarEvent(subscription, imported, new Date("2026-10-01T00:00:00Z"));
  const refresh = toReadOnlyCalendarEvent(subscription, imported, new Date("2026-10-02T00:00:00Z"));
  assert.equal(first.id, refresh.id);
  assert.equal(first.allDay, true);
  assert.equal(first.endDate, "2026-10-06");
  assert.equal(first.notes, "");
  assert.equal(first.recurrence, undefined);
  assert.equal(toReadOnlyCalendarEvent({ ...subscription, visible: false }, imported), undefined);
  assert.equal(toReadOnlyCalendarEvent(subscription, { ...imported, end: "2026-10-03" }), undefined);
});
