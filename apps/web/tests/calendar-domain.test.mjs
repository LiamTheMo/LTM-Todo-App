import test from "node:test";
import assert from "node:assert/strict";
import { calendarEventsForDay, calendarEventOccurrences, saveCalendarEvent, validEvent, zonedDateTimeToInstant } from "../lib/calendar-domain.ts";
import { emptyData, newEntity } from "../lib/domain.ts";

const eventBase = (data, fields) => ({
  ...newEntity(new Date("2026-01-01T00:00:00Z")),
  calendarId: data.calendars[0].id,
  title: "Event",
  notes: "",
  allDay: true,
  startDate: "2026-01-01",
  endDate: "2026-01-02",
  ...fields
});

test("all-day events are date-only, span their exclusive end date, and do not become tasks", () => {
  const data = emptyData();
  const event = eventBase(data, { startDate: "2026-03-08", endDate: "2026-03-10" });
  data.calendarEvents.push(event);
  assert.deepEqual(calendarEventsForDay(data, "2026-03-07"), []);
  assert.equal(calendarEventsForDay(data, "2026-03-08")[0].startDate, "2026-03-08");
  assert.equal(calendarEventsForDay(data, "2026-03-09")[0].endDate, "2026-03-10");
  assert.deepEqual(calendarEventsForDay(data, "2026-03-10"), []);
  assert.deepEqual(data.tasks, []);
});

test("event visibility filters by local calendar without hiding tasks or other calendars", () => {
  const data = emptyData();
  const secondCalendar = { ...newEntity(), name: "School", color: "blue", visible: false, sortKey: 1 };
  data.calendars.push(secondCalendar);
  data.calendarEvents.push(
    eventBase(data, { title: "Personal event" }),
    eventBase(data, { title: "School event", calendarId: secondCalendar.id })
  );
  assert.deepEqual(calendarEventsForDay(data, "2026-01-01").map(item => item.event.title), ["Personal event"]);
  assert.deepEqual(calendarEventsForDay(data, "2026-01-01", false).map(item => item.event.title), ["Personal event", "School event"]);
});

test("weekly and monthly recurrence are deterministic and obey occurrence counts", () => {
  const data = emptyData();
  const weekly = eventBase(data, { startDate: "2026-01-05", endDate: "2026-01-06", recurrence: {
    frequency: "weekly", interval: 2, weekdays: [1, 3], count: 4
  } });
  const monthly = eventBase(data, { title: "Monthly", startDate: "2026-01-31", endDate: "2026-02-01", recurrence: {
    frequency: "monthly", interval: 1, count: 3
  } });
  data.calendarEvents.push(weekly, monthly);
  assert.deepEqual(calendarEventOccurrences(data, "2026-01-01", "2026-03-31")
    .filter(item => item.event.id === weekly.id).map(item => item.occurrenceDate),
  ["2026-01-05", "2026-01-07", "2026-01-19", "2026-01-21"]);
  assert.deepEqual(calendarEventOccurrences(data, "2026-01-01", "2026-04-01")
    .filter(item => item.event.id === monthly.id).map(item => item.occurrenceDate),
  ["2026-01-31", "2026-02-28", "2026-03-31"]);
});

test("recurring timed events retain wall-clock time across daylight-saving changes", () => {
  const data = emptyData();
  data.calendarEvents.push(eventBase(data, {
    allDay: false, startInstant: "2026-03-07T16:00:00.000Z", endInstant: "2026-03-07T17:00:00.000Z",
    timeZone: "America/Edmonton", recurrence: { frequency: "daily", interval: 1, count: 3 }
  }));
  const occurrences = calendarEventOccurrences(data, "2026-03-07", "2026-03-10");
  assert.deepEqual(occurrences.map(item => item.startInstant), [
    "2026-03-07T16:00:00.000Z", "2026-03-08T15:00:00.000Z", "2026-03-09T15:00:00.000Z"
  ]);
});

test("DST gaps move to the first valid minute and ambiguous fall-back times choose the earlier instant", () => {
  assert.equal(zonedDateTimeToInstant("2026-03-08", "02:30", "America/Edmonton"), "2026-03-08T09:00:00.000Z");
  assert.equal(zonedDateTimeToInstant("2026-11-01", "01:30", "America/Edmonton"), "2026-11-01T07:30:00.000Z");
});

test("invalid events are rejected and editing preserves record identity", () => {
  const data = emptyData();
  const event = eventBase(data, { title: "  dentist  " });
  const saved = saveCalendarEvent(data, event);
  assert.equal(saved.calendarEvents[0].title, "dentist");
  const edited = saveCalendarEvent(saved, { ...saved.calendarEvents[0], title: "  appointment " });
  assert.equal(edited.calendarEvents[0].id, event.id);
  assert.equal(edited.calendarEvents[0].createdAt, event.createdAt);
  assert.equal(edited.calendarEvents[0].revision, 2);
  assert.equal(validEvent(eventBase(data, { startDate: "2026-03-10", endDate: "2026-03-10" })), false);
  assert.equal(saveCalendarEvent(data, eventBase(data, { calendarId: "missing" })), data);
});
