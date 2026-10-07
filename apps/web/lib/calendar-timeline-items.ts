import { addDays, dashboardDays, localDate, type Data } from "./domain.ts";
import { calendarEventsForDay, defaultCalendarColor, zonedDateTimeToInstant } from "./calendar-domain.ts";

export type CalendarTimelineItem = {
  id: string;
  title: string;
  caption: string;
  start: string;
  end: string;
  color: string;
};

const timeLabel = (instant: string) => new Date(instant).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Build the same visible events, planned-work blocks, and deadlines shown in the Calendar tab. */
export function calendarTimelineItemsForDay(
  data: Data,
  day: string,
  today = localDate(new Date()),
  agendaOverride?: ReturnType<typeof dashboardDays>[number]
): CalendarTimelineItem[] {
  const agenda = agendaOverride ?? dashboardDays(data, day, 1, today)[0];
  if (!agenda) return [];
  const events = calendarEventsForDay(data, day);
  const plannedTaskIds = new Set(agenda.scheduled.map(({ task }) => task.id));
  const calendars = new Map(data.calendars.map(calendar => [calendar.id, calendar]));

  return [
    ...events.flatMap(item => {
      if (item.allDay || item.event.allDay || !item.startInstant || !item.endInstant) return [];
      const event = item.event;
      const start = localDate(new Date(item.startInstant)) < day
        ? zonedDateTimeToInstant(day, "00:00", event.timeZone) ?? item.startInstant
        : item.startInstant;
      const lastEventDay = localDate(new Date(Date.parse(item.endInstant) - 1));
      const end = lastEventDay > day
        ? zonedDateTimeToInstant(addDays(day, 1), "00:00", event.timeZone) ?? item.endInstant
        : item.endInstant;
      return [{ id: `event:${event.id}:${item.occurrenceDate}`, title: event.title,
        caption: `${timeLabel(start)} – ${timeLabel(end)} · Event`, start, end,
        color: calendars.get(event.calendarId)?.color ?? defaultCalendarColor }];
    }),
    ...agenda.scheduled.map(({ block, task }) => ({ id: `block:${block.id}`, title: task.title,
      caption: `${timeLabel(block.startInstant)} – ${timeLabel(block.endInstant)} · Planned work`,
      start: block.startInstant, end: block.endInstant, color: "blue" })),
    ...agenda.due.filter(task => task.dueTime && !plannedTaskIds.has(task.id)).flatMap(task => {
      const start = zonedDateTimeToInstant(day, task.dueTime!, task.dueTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (!start) return [];
      const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
      return [{ id: `deadline:${task.id}`, title: task.title, caption: "Task deadline", start, end, color: "orange" }];
    })
  ];
}
