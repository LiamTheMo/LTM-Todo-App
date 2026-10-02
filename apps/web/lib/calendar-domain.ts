import {
  addDays, instantDay, newEntity, parseLocalDate, type CalendarColor,
  type CalendarEvent, type CalendarEventOccurrence, type Data, type EventTemplate, type LocalCalendar
} from "./domain.ts";

export const defaultCalendarColor: CalendarColor = "#CF6D27";
const legacyCalendarColors: Record<string, CalendarColor> = {
  orange: "#CF6D27", blue: "#3982C4", green: "#368A5A",
  purple: "#8356B5", red: "#C44842", teal: "#218E8B"
};
export function normalizeCalendarColor(value: unknown): CalendarColor | undefined {
  if (typeof value !== "string") return;
  const key = value.toLowerCase();
  const legacy = Object.prototype.hasOwnProperty.call(legacyCalendarColors, key) ? legacyCalendarColors[key] : undefined;
  if (legacy) return legacy;
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() as CalendarColor : undefined;
}
const dayMilliseconds = 86_400_000;
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(parseLocalDate(value).getTime()) && addDays(value, 0) === value;
const dayOrdinal = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / dayMilliseconds);
};
const dateAtMonth = (anchor: string, months: number) => {
  const [year, month, date] = anchor.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return String(first.getUTCFullYear()) + "-" + String(first.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(Math.min(date, last)).padStart(2, "0");
};

function zonedParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
}
function wallClockCandidates(day: string, time: string, timeZone: string) {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  const offsets = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 6) {
    const sample = wall + delta * 3_600_000;
    const part = zonedParts(sample, timeZone);
    const represented = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute);
    offsets.add(represented - sample);
  }
  const matches = (target: number) => [...offsets].map(offset => target - offset)
    .filter(candidate => {
      const part = zonedParts(candidate, timeZone);
      return part.year === year && part.month === month && part.day === date && part.hour === hour && part.minute === minute;
    }).sort((a, b) => a - b);
  return { wall, matches };
}

/** Ambiguous fall-back times choose the earlier instant; nonexistent spring-forward times move to the first valid minute. */
export function zonedDateTimeToInstant(day: string, time: string, timeZone: string): string | undefined {
  if (!validDay(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return;
  try {
    const { wall, matches } = wallClockCandidates(day, time, timeZone);
    const exact = matches(wall);
    if (exact.length) return new Date(exact[0]).toISOString();
    for (let minute = 1; minute <= 180; minute++) {
      const target = new Date(wall + minute * 60_000);
      const targetDay = String(target.getUTCFullYear()) + "-" + String(target.getUTCMonth() + 1).padStart(2, "0") + "-" + String(target.getUTCDate()).padStart(2, "0");
      const targetTime = String(target.getUTCHours()).padStart(2, "0") + ":" + String(target.getUTCMinutes()).padStart(2, "0");
      const found = wallClockCandidates(targetDay, targetTime, timeZone).matches(target.getTime());
      if (found.length) return new Date(found[0]).toISOString();
    }
  } catch { return; }
  return;
}

function eventStartDate(event: CalendarEvent) {
  return event.allDay ? event.startDate : instantDay(event.startInstant, event.timeZone);
}
function eventDurationDays(event: CalendarEvent) {
  return event.allDay ? Math.max(1, dayOrdinal(event.endDate) - dayOrdinal(event.startDate)) :
    Math.max(0, dayOrdinal(instantDay(event.endInstant, event.timeZone)) - dayOrdinal(instantDay(event.startInstant, event.timeZone)));
}
function recurrenceStartDates(event: CalendarEvent, from: string, toExclusive: string): string[] {
  const start = eventStartDate(event);
  const rule = event.recurrence;
  if (!rule) return start >= from && start < toExclusive ? [start] : [];
  const step = Math.max(1, Math.floor(rule.interval));
  const count = rule.count === undefined ? Infinity : Math.max(1, Math.floor(rule.count));
  const results: string[] = [];
  if (rule.frequency === "daily") {
    const firstIndex = Math.max(0, Math.ceil((dayOrdinal(from) - dayOrdinal(start)) / step));
    for (let index = firstIndex; index + 1 <= count; index++) {
      const day = addDays(start, index * step);
      if ((rule.until && day > rule.until) || day >= toExclusive) break;
      results.push(day);
    }
  } else if (rule.frequency === "monthly" || rule.frequency === "yearly") {
    const monthStep = rule.frequency === "monthly" ? step : step * 12;
    const monthDistance = (day: string) => {
      const [year, month] = day.split("-").map(Number);
      const [startYear, startMonth] = start.split("-").map(Number);
      return (year - startYear) * 12 + month - startMonth;
    };
    let index = Math.max(0, Math.floor(monthDistance(from) / monthStep));
    while (dateAtMonth(start, index * monthStep) < from) index++;
    for (; index + 1 <= count; index++) {
      const day = dateAtMonth(start, index * monthStep);
      if ((rule.until && day > rule.until) || day >= toExclusive) break;
      results.push(day);
    }
  } else {
    const startWeekday = parseLocalDate(start).getDay();
    const weekdays = [...new Set(rule.weekdays?.length ? rule.weekdays : [startWeekday])]
      .filter(day => Number.isInteger(day) && day >= 0 && day <= 6).sort((a, b) => a - b);
    if (!weekdays.length) return results;
    const firstWeek = addDays(start, -startWeekday);
    const queryWeek = Math.max(0, Math.floor((dayOrdinal(from) - dayOrdinal(firstWeek)) / 7));
    const firstCycle = Math.floor(queryWeek / step) * step;
    let occurrenceIndex = 0;
    for (let cycle = 0; cycle < firstCycle; cycle += step) {
      occurrenceIndex += weekdays.length - (cycle === 0 ? weekdays.filter(day => day < startWeekday).length : 0);
    }
    for (let cycle = firstCycle; ; cycle += step) {
      for (const weekday of weekdays) {
        const day = addDays(firstWeek, cycle * 7 + weekday);
        if (day < start) continue;
        const index = occurrenceIndex++;
        if ((rule.until && day > rule.until) || day >= toExclusive || index + 1 > count) return results;
        results.push(day);
      }
    }
  }
  return results;
}

function occurrence(event: CalendarEvent, date: string): CalendarEventOccurrence | undefined {
  if (event.allDay) {
    const duration = eventDurationDays(event);
    return { event, occurrenceDate: date, allDay: true, startDate: date, endDate: addDays(date, duration) };
  }
  const parts = zonedParts(Date.parse(event.startInstant), event.timeZone);
  const wallTime = String(parts.hour).padStart(2, "0") + ":" + String(parts.minute).padStart(2, "0");
  const startInstant = zonedDateTimeToInstant(date, wallTime, event.timeZone);
  if (!startInstant) return;
  const duration = Date.parse(event.endInstant) - Date.parse(event.startInstant);
  if (!Number.isFinite(duration) || duration <= 0) return;
  return { event, occurrenceDate: date, allDay: false, startInstant, endInstant: new Date(Date.parse(startInstant) + duration).toISOString() };
}

export function calendarEventOccurrences(data: Data, from: string, toExclusive: string, visibleOnly = true): CalendarEventOccurrence[] {
  if (!validDay(from) || !validDay(toExclusive) || toExclusive <= from) return [];
  const calendars = new Map(data.calendars.map(calendar => [calendar.id, calendar]));
  const occurrences: CalendarEventOccurrence[] = [];
  for (const event of data.calendarEvents) {
    const calendar = calendars.get(event.calendarId);
    if (event.deletedAt || !calendar || calendar.deletedAt || (visibleOnly && !calendar.visible)) continue;
    try { eventStartDate(event); } catch { continue; }
    const searchFrom = addDays(from, -eventDurationDays(event));
    for (const date of recurrenceStartDates(event, searchFrom, toExclusive)) {
      const item = occurrence(event, date);
      if (!item) continue;
      if (item.allDay) {
        if (date < toExclusive && item.endDate! > from) occurrences.push(item);
      } else {
        if (event.allDay) continue;
        const lastDay = instantDay(new Date(Date.parse(item.endInstant!) - 1).toISOString(), event.timeZone);
        if (lastDay >= from && date < toExclusive) occurrences.push(item);
      }
    }
  }
  return occurrences.sort((left, right) =>
    Number(right.allDay) - Number(left.allDay) ||
    (left.startInstant ?? left.occurrenceDate).localeCompare(right.startInstant ?? right.occurrenceDate) ||
    left.event.title.localeCompare(right.event.title));
}

export function calendarEventsForDay(data: Data, day: string, visibleOnly = true) {
  return calendarEventOccurrences(data, day, addDays(day, 1), visibleOnly).filter(item => item.allDay
    ? item.startDate! <= day && item.endDate! > day
    : !item.event.allDay && (item.occurrenceDate === day || instantDay(item.endInstant!, item.event.timeZone) === day));
}

export function createCalendar(name: string, color: CalendarColor = defaultCalendarColor, now = new Date()): LocalCalendar | undefined {
  const clean = name.trim();
  const normalizedColor = normalizeCalendarColor(color);
  if (!clean || !normalizedColor) return;
  return { ...newEntity(now), name: clean, color: normalizedColor, visible: true, sortKey: now.getTime() };
}

export function saveEventTemplate(data: Data, event: CalendarEvent, name: string): Data {
  const clean = name.trim();
  if (!clean || !validEvent(event) || !data.calendars.some(calendar => calendar.id === event.calendarId && !calendar.deletedAt)) return data;
  const duration = event.allDay ? Math.max(1, eventDurationDays(event)) :
    Math.max(1, Math.round((Date.parse(event.endInstant) - Date.parse(event.startInstant)) / 60_000));
  const startTime = event.allDay ? undefined : (() => {
    const parts = zonedParts(Date.parse(event.startInstant), event.timeZone);
    return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  })();
  const template: EventTemplate = { ...newEntity(), name: clean, calendarId: event.calendarId, title: event.title,
    notes: event.notes, allDay: event.allDay, duration, timeZone: event.allDay ? undefined : event.timeZone, startTime };
  return { ...data, eventTemplates: [...data.eventTemplates, template] };
}

export function instantiateEventTemplate(data: Data, templateId: string, date: string): Data {
  const template = data.eventTemplates.find(item => item.id === templateId && !item.deletedAt);
  if (!template || !validDay(date) || !data.calendars.some(calendar => calendar.id === template.calendarId && !calendar.deletedAt)) return data;
  const base = { ...newEntity(), calendarId: template.calendarId, title: template.title, notes: template.notes };
  if (template.allDay) return saveCalendarEvent(data, { ...base, allDay: true, startDate: date, endDate: addDays(date, template.duration) });
  const timeZone = template.timeZone ?? "UTC";
  const startInstant = zonedDateTimeToInstant(date, template.startTime ?? "09:00", timeZone);
  if (!startInstant || template.duration < 1) return data;
  const endInstant = new Date(Date.parse(startInstant) + template.duration * 60_000).toISOString();
  return saveCalendarEvent(data, { ...base, allDay: false, startInstant, endInstant, timeZone });
}

export function saveCalendarEvent(data: Data, event: CalendarEvent): Data {
  const title = event.title.trim();
  const calendar = data.calendars.find(item => item.id === event.calendarId && !item.deletedAt);
  if (!title || !calendar || !validEvent(event)) return data;
  const existing = data.calendarEvents.find(item => item.id === event.id);
  const stamp = new Date().toISOString();
  const saved = { ...event, title, notes: event.notes.trim(), createdAt: existing?.createdAt ?? event.createdAt,
    updatedAt: stamp, revision: existing ? existing.revision + 1 : 1 } as CalendarEvent;
  return { ...data, calendarEvents: existing
    ? data.calendarEvents.map(item => item.id === event.id ? saved : item)
    : [...data.calendarEvents, saved] };
}

export function validEvent(event: CalendarEvent): boolean {
  if (!event || typeof event !== "object" || typeof event.title !== "string" || !event.title.trim() ||
      typeof event.notes !== "string" || typeof event.calendarId !== "string" || !event.calendarId ||
      !Number.isSafeInteger(event.revision) || event.revision < 1) return false;
  if (event.recurrence) {
    const rule = event.recurrence;
    if (!Number.isSafeInteger(rule.interval) || rule.interval < 1 ||
        (rule.count !== undefined && (!Number.isSafeInteger(rule.count) || rule.count < 1)) ||
        (rule.until !== undefined && !validDay(rule.until)) ||
        (rule.weekdays !== undefined && (!Array.isArray(rule.weekdays) || rule.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)))) return false;
  }
  if (event.allDay) return validDay(event.startDate) && validDay(event.endDate) && event.endDate > event.startDate;
  try {
    return Number.isFinite(Date.parse(event.startInstant)) && Number.isFinite(Date.parse(event.endInstant)) &&
      Date.parse(event.endInstant) > Date.parse(event.startInstant) && Boolean(new Intl.DateTimeFormat("en", { timeZone: event.timeZone }));
  } catch { return false; }
}
