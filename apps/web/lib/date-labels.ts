const millisecondsPerDay = 86_400_000;

function dateOrdinal(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / millisecondsPerDay);
}

export function calendarDayDifference(from: string, to: string): number {
  return dateOrdinal(to) - dateOrdinal(from);
}

export function overdueDueCaption(dueDate: string, today: string): string {
  const daysAgo = calendarDayDifference(dueDate, today);
  if (!Number.isInteger(daysAgo) || daysAgo < 1) return "Overdue";
  return `Due ${daysAgo} ${daysAgo === 1 ? "day" : "days"} ago`;
}

export function dueTimeCaption(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return value;
  return `${hour % 12 || 12}:${match[2]}${hour < 12 ? "am" : "pm"}`;
}
