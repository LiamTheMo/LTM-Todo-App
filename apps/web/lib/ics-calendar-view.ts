import type { CalendarEvent } from "./domain.ts";
import { validEvent } from "./calendar-domain.ts";
import type { IcsCalendarEvent } from "./ics-calendar.ts";

export type IcsCalendarView = {
  subscriptionId: string;
  calendarId: string;
  visible: boolean;
};

/** Projects an imported feed row into an ephemeral event; it is never persisted or made editable. */
export function toReadOnlyCalendarEvent(subscription: IcsCalendarView, source: IcsCalendarEvent, now = new Date()): CalendarEvent | undefined {
  if (!subscription?.visible || typeof subscription.subscriptionId !== "string" || typeof subscription.calendarId !== "string" ||
      !source || typeof source !== "object" || typeof source.uid !== "string" || !source.uid || source.uid.length > 512 ||
      typeof source.recurrenceId !== "string" || !source.recurrenceId || source.recurrenceId.length > 512 ||
      typeof source.title !== "string" || !source.title.trim() || source.title.length > 240) return;
  const stamp = now.toISOString();
  const base = { id: `ics:${subscription.subscriptionId}:${encodeURIComponent(source.uid)}:${encodeURIComponent(source.recurrenceId)}`,
    calendarId: subscription.calendarId, title: source.title.trim(), notes: "", createdAt: stamp, updatedAt: stamp, revision: 1 };
  const event: CalendarEvent | undefined = source.allDay === true
    ? { ...base, allDay: true, startDate: source.start, endDate: source.end }
    : source.allDay === false
      ? { ...base, allDay: false, startInstant: source.start, endInstant: source.end,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" }
      : undefined;
  return event && validEvent(event) ? event : undefined;
}
