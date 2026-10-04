import ICAL from "ical.js";

export const MAX_ICS_BYTES = 512_000;
export const MAX_ICS_EVENTS = 2_000;
export const MAX_ICS_OCCURRENCES = 2_000;
export const MAX_ICS_ITERATIONS = 20_000;
const MAX_WINDOW_DAYS = 180;

export type IcsCalendarEvent = {
  uid: string;
  recurrenceId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
};

/** Parses an untrusted, bounded ICS document into plain read-only events. */
export function parseIcsCalendar(source: string, from: Date, to: Date): IcsCalendarEvent[] {
  if (new TextEncoder().encode(source).byteLength > MAX_ICS_BYTES) throw new Error("Calendar feed exceeds 512 KB");
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from || to.getTime() - from.getTime() > MAX_WINDOW_DAYS * 86_400_000) {
    throw new Error("Calendar range is invalid or too large");
  }
  if (/\u0000/.test(source)) throw new Error("Calendar feed contains invalid control data");
  let calendar: InstanceType<typeof ICAL.Component>;
  try { calendar = ICAL.Component.fromString(source); }
  catch { throw new Error("Calendar feed could not be parsed"); }
  if (calendar.name !== "vcalendar" || calendar.getFirstPropertyValue("version") !== "2.0") {
    throw new Error("Calendar feed is not iCalendar 2.0");
  }
  const components = calendar.getAllSubcomponents("vevent");
  if (components.length > MAX_ICS_EVENTS) throw new Error("Calendar feed contains too many events");
  const startBoundary = ICAL.Time.fromJSDate(from, true);
  const endBoundary = ICAL.Time.fromJSDate(to, true);
  const result: IcsCalendarEvent[] = [];
  const seen = new Set<string>();
  const titleByUid = new Map<string, string>();
  let iterations = 0;
  const append = (uid: string, recurrenceId: string, title: string, start: InstanceType<typeof ICAL.Time>, end: InstanceType<typeof ICAL.Time>) => {
    if (!uid || !title || start.compare(end) >= 0 || start.compare(endBoundary) >= 0 || end.compare(startBoundary) <= 0) return;
    const key = `${uid}\u0000${recurrenceId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const allDay = start.isDate;
    result.push({ uid, recurrenceId, title, start: allDay ? start.toString() : start.toJSDate().toISOString(),
      end: allDay ? end.toString() : end.toJSDate().toISOString(), allDay });
  };
  for (const component of components) {
    const event = new ICAL.Event(component);
    const uid = cleanText(component.getFirstPropertyValue("uid"), 512);
    const title = cleanText(event.summary, 240);
    if (!uid || !title || event.isRecurrenceException() || cleanText(event.component.getFirstPropertyValue("status"), 32).toUpperCase() === "CANCELLED") continue;
    titleByUid.set(uid, title);
    const iterator = event.iterator();
    let occurrence = iterator.next();
    while (occurrence && result.length < MAX_ICS_OCCURRENCES) {
      if (++iterations > MAX_ICS_ITERATIONS) throw new Error("Calendar feed recurrence expansion is too complex");
      if (occurrence.compare(endBoundary) >= 0) break;
      const details = event.getOccurrenceDetails(occurrence);
      const occurrenceEvent = details.item;
      const start = details.startDate;
      const end = details.endDate;
      if (occurrenceEvent && start && end && cleanText(occurrenceEvent.component.getFirstPropertyValue("status"), 32).toUpperCase() !== "CANCELLED" &&
          start.compare(end) < 0 && start.compare(endBoundary) < 0 && end.compare(startBoundary) > 0) {
        append(uid, stableRecurrenceId(occurrence), cleanText(occurrenceEvent.summary || title, 240), start, end);
      }
      // A non-recurring event has exactly one candidate and must not be iterated further.
      if (!event.isRecurring()) break;
      occurrence = iterator.next();
    }
    if (result.length >= MAX_ICS_OCCURRENCES) break;
  }
  // A detached exception may move an occurrence into this window even when its original
  // recurrence ID is outside it, so the master's bounded iterator cannot discover it.
  for (const component of components) {
    if (result.length >= MAX_ICS_OCCURRENCES) break;
    const event = new ICAL.Event(component);
    if (!event.isRecurrenceException() || cleanText(component.getFirstPropertyValue("status"), 32).toUpperCase() === "CANCELLED") continue;
    const uid = cleanText(component.getFirstPropertyValue("uid"), 512);
    const recurrenceId = event.recurrenceId;
    if (!uid || !recurrenceId) continue;
    append(uid, stableRecurrenceId(recurrenceId), cleanText(event.summary, 240) || titleByUid.get(uid) || "", event.startDate, event.endDate);
  }
  return result;
}

function stableRecurrenceId(value: InstanceType<typeof ICAL.Time>): string {
  return value.isDate ? value.toString() : value.convertToZone(ICAL.Timezone.utcTimezone).toString();
}

function cleanText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}
