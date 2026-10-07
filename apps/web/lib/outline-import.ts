import { addDays, historyStart, newEntity, saveTask, type Data, type CalendarEvent, type EventRecurrence } from "./domain.ts";
import { saveCalendarEvent, zonedDateTimeToInstant } from "./calendar-domain.ts";
import { MAX_OUTLINE_ITEMS, validOutlineDate, type OutlineItem } from "./outline-parser.ts";

export type OutlineDestination = { calendarId: string; projectId?: string; timeZone: string; reminderMinutes?: string; readOnlyCalendarIds?: string[] };
const titleKey = (title: string) => title.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
const recurrenceKey = (rule?: EventRecurrence) => rule ? JSON.stringify({ frequency: rule.frequency, interval: rule.interval,
  weekdays: [...new Set(rule.weekdays || [])].sort(), until: rule.until || null, count: rule.count || null }) : "";
function sameEventDates(event: CalendarEvent, candidate: CalendarEvent): boolean {
  if (event.allDay !== candidate.allDay) return false;
  const weekly = event.recurrence?.frequency === "weekly" && event.recurrence.interval === 1 && candidate.recurrence?.frequency === "weekly";
  if (event.allDay && candidate.allDay) {
    return weekly ? Date.parse(event.endDate) - Date.parse(event.startDate) === Date.parse(candidate.endDate) - Date.parse(candidate.startDate) && event.startDate <= candidate.startDate
      : event.startDate === candidate.startDate && event.endDate === candidate.endDate;
  }
  if (!event.allDay && !candidate.allDay) {
    if (!weekly) return event.startInstant === candidate.startInstant && event.endInstant === candidate.endInstant;
    const time = (value: string) => new Intl.DateTimeFormat("en", { timeZone: candidate.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
    return event.timeZone === candidate.timeZone && event.startInstant <= candidate.startInstant &&
      time(event.startInstant) === time(candidate.startInstant) && time(event.endInstant) === time(candidate.endInstant) &&
      Date.parse(event.endInstant) - Date.parse(event.startInstant) === Date.parse(candidate.endInstant) - Date.parse(candidate.startInstant);
  }
  return false;
}
export function outlineItemError(item: OutlineItem, today: string): string | undefined {
  if (!item.title.trim() || item.title.length > 240) return "Enter a title of 1–240 characters.";
  if (!validOutlineDate(item.date)) return "Choose a valid date.";
  if (item.date < historyStart(today)) return "Date is outside the retained 31-day history window.";
  if (item.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) return "Choose a valid time.";
  if (item.kind === "event") {
    if (!validOutlineDate(item.endDate) || item.endDate < item.date) return "End date must be on or after start date.";
    if (Boolean(item.time) !== Boolean(item.endTime)) return "Provide both start and end times, or clear both for an all-day event.";
    if (item.endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.endTime)) return "Choose a valid end time.";
    if (item.time && item.date === item.endDate && item.endTime <= item.time) return "End time must be after start time. Set next day's end date for overnight events.";
    if (item.weekdays.length && (!validOutlineDate(item.until) || item.until < item.date || item.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6))) return "Weekly events need valid weekdays and a repeat-until date on or after their start.";
  }
}
function buildEvent(item: OutlineItem, destination: OutlineDestination, now: Date): CalendarEvent {
  const base = { ...newEntity(now), calendarId: destination.calendarId, title: item.title.trim(), notes: "",
    recurrence: item.weekdays.length ? { frequency: "weekly" as const, interval: 1, weekdays: item.weekdays, until: item.until } : undefined };
  if (!item.time) return { ...base, allDay: true, startDate: item.date, endDate: addDays(item.endDate, 1) };
  const startInstant = zonedDateTimeToInstant(item.date, item.time, destination.timeZone);
  const endInstant = zonedDateTimeToInstant(item.endDate, item.endTime, destination.timeZone);
  if (!startInstant || !endInstant || endInstant <= startInstant) throw new Error("Event times are invalid in the selected time zone.");
  return { ...base, allDay: false, startInstant, endInstant, timeZone: destination.timeZone };
}
export function isOutlineDuplicate(data: Data, item: OutlineItem, destination: OutlineDestination): boolean {
  if (item.kind === "task") return data.tasks.some(task => !task.deletedAt && titleKey(task.title) === titleKey(item.title) &&
    task.dueDate === item.date && (task.dueTime || "") === item.time && task.projectId === (destination.projectId || undefined) &&
    (!item.time || task.dueTimeZone === destination.timeZone));
  try {
    const candidate = buildEvent(item, destination, new Date());
    return data.calendarEvents.some(event => !event.deletedAt && event.calendarId === destination.calendarId && titleKey(event.title) === titleKey(item.title) &&
      recurrenceKey(event.recurrence) === recurrenceKey(candidate.recurrence) && sameEventDates(event, candidate));
  } catch { return false; }
}
/** Validates the entire batch before returning a new Data value; source text/file bytes are never persisted. */
export function importOutlineItems(data: Data, items: OutlineItem[], destination: OutlineDestination, today: string, now = new Date()): { data: Data; added: number; skipped: number } {
  const selected = items.filter(item => item.selected);
  if (!selected.length || selected.length > MAX_OUTLINE_ITEMS) throw new Error(`Select 1–${MAX_OUTLINE_ITEMS.toLocaleString()} items to import.`);
  try { new Intl.DateTimeFormat("en", { timeZone: destination.timeZone }); } catch { throw new Error("Choose a valid IANA time zone, such as America/Edmonton."); }
  if (destination.projectId && !data.projects.some(project => project.id === destination.projectId && !project.deletedAt)) throw new Error("Choose an active project.");
  if (selected.some(item => item.kind === "event") && (!data.calendars.some(calendar => calendar.id === destination.calendarId && !calendar.deletedAt) || destination.readOnlyCalendarIds?.includes(destination.calendarId))) throw new Error("Choose an editable calendar.");
  if (destination.reminderMinutes && (!/^\d+$/.test(destination.reminderMinutes) || +destination.reminderMinutes > 10_080)) throw new Error("Reminder must be between 0 and 10,080 minutes.");
  for (const item of selected) {
    const error = outlineItemError(item, today);
    if (error) throw new Error(`${item.title || "Item"}: ${error}`);
    if (item.kind === "event") buildEvent(item, destination, now);
  }
  let next = data;
  let added = 0;
  let skipped = 0;
  for (const item of selected) {
    if (isOutlineDuplicate(next, item, destination)) { skipped++; continue; }
    if (item.kind === "task") {
      next = saveTask(next, { ...newEntity(now), title: item.title.trim(), notes: item.notes || "", priority: item.priority || "low", tagIds: [],
        sortKey: next.tasks.length, projectId: destination.projectId || undefined, dueDate: item.date,
        dueTime: item.time || undefined, dueTimeZone: item.time ? destination.timeZone : undefined }, destination.reminderMinutes || "", today);
    } else next = saveCalendarEvent(next, { ...buildEvent(item, destination, now), notes: item.notes || "" });
    added++;
  }
  return { data: next, added, skipped };
}
