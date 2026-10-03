import test from "node:test";
import assert from "node:assert/strict";
import { createCalendar, updateCalendar, normalizeCalendarColor, calendarEventsForDay, calendarEventOccurrences, instantiateEventTemplate, saveCalendarEvent, saveEventTemplate, validEvent, zonedDateTimeToInstant } from "../lib/calendar-domain.ts";
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

test("event templates preserve local start time and duration while creating fresh events", () => {
  const data = emptyData();
  const event = eventBase(data, { allDay: false, startInstant: "2026-10-01T15:30:00.000Z", endInstant: "2026-10-01T16:15:00.000Z", timeZone: "America/Edmonton" });
  const saved = saveEventTemplate(data, event, "  School pickup  ");
  assert.equal(saved.eventTemplates[0].name, "School pickup");
  assert.equal(saved.eventTemplates[0].startTime, "09:30");
  assert.equal(saved.eventTemplates[0].duration, 45);
  const created = instantiateEventTemplate(saved, saved.eventTemplates[0].id, "2026-10-02");
  assert.equal(created.calendarEvents.length, 1);
  assert.equal(created.calendarEvents[0].startInstant, "2026-10-02T15:30:00.000Z");
  assert.equal(created.calendarEvents[0].endInstant, "2026-10-02T16:15:00.000Z");
  assert.notEqual(created.calendarEvents[0].id, event.id);
});

test("calendar colors accept the full RGB spectrum and normalize legacy presets", () => {
  assert.equal(normalizeCalendarColor("#01aBcD"), "#01ABCD");
  assert.equal(normalizeCalendarColor("orange"), "#CF6D27");
  assert.equal(normalizeCalendarColor("#FFF"), undefined);
  assert.equal(normalizeCalendarColor("constructor"), undefined);
  const custom = createCalendar("Custom", "#123456");
  assert.equal(custom.color, "#123456");
  assert.equal(createCalendar("Bad", "rgb(1,2,3)"), undefined);
});

test("editing a calendar renames and recolors it without changing its identity or linked events", () => {
  const data = emptyData();
  const original = data.calendars[0];
  const event = eventBase(data, { calendarId: original.id });
  data.calendarEvents.push(event);
  const now = new Date("2026-02-03T04:05:06.000Z");
  const updated = updateCalendar(data, original.id, "  Work  ", "#00FF80", now);
  const calendar = updated.calendars[0];
  assert.equal(calendar.id, original.id);
  assert.equal(calendar.createdAt, original.createdAt);
  assert.equal(calendar.name, "Work");
  assert.equal(calendar.color, "#00FF80");
  assert.equal(calendar.visible, original.visible);
  assert.equal(calendar.sortKey, original.sortKey);
  assert.equal(calendar.revision, original.revision + 1);
  assert.equal(calendar.updatedAt, now.toISOString());
  assert.equal(updated.calendarEvents[0].calendarId, event.calendarId);
  assert.equal(updateCalendar(data, "missing", "Work", "#00FF80"), data);
  assert.equal(updateCalendar(data, original.id, " ", "#00FF80"), data);
});
