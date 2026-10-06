import { zonedDateTimeToInstant } from "./calendar-domain.ts";

export type BusyTimeRange = { startInstant: string; endInstant: string };
export type AvailableWorkSlot = { startInstant: string; endInstant: string };

/** Suggest one-hour-or-shorter work slots during the local 6 a.m.–10 p.m. day. */
export function availableWorkSlots(
  day: string,
  timeZone: string,
  busyRanges: BusyTimeRange[],
  durationMinutes = 60,
  notBefore = Date.now(),
  stepMinutes = 30
): AvailableWorkSlot[] {
  if (!Number.isFinite(durationMinutes) || durationMinutes < 1 ||
      !Number.isFinite(stepMinutes) || stepMinutes < 1) return [];

  const duration = Math.floor(durationMinutes) * 60_000;
  const step = Math.floor(stepMinutes);
  const occupied = busyRanges.flatMap(range => {
    const start = Date.parse(range.startInstant);
    const end = Date.parse(range.endInstant);
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [{ start, end }] : [];
  });
  const slots: AvailableWorkSlot[] = [];
  const seen = new Set<string>();

  for (let minute = 6 * 60; minute + Math.ceil(durationMinutes) <= 22 * 60; minute += step) {
    const startTime = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const startInstant = zonedDateTimeToInstant(day, startTime, timeZone);
    if (!startInstant || seen.has(startInstant)) continue;
    const start = Date.parse(startInstant);
    const end = start + duration;
    if (start < notBefore || occupied.some(range => start < range.end && end > range.start)) continue;
    seen.add(startInstant);
    slots.push({ startInstant, endInstant: new Date(end).toISOString() });
  }
  return slots;
}
