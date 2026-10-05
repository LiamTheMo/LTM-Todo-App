import type { Frequency, Recurrence } from "./domain";

export const repeatPresets = [
  { value: "daily", label: "Daily" },
  { value: "every-other-day", label: "Every other day" },
  { value: "weekdays", label: "Weekdays (Mon–Fri)" },
  { value: "weekends", label: "Weekends (Sat–Sun)" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly (every 2 weeks)" },
  { value: "monthly", label: "Monthly" },
  { value: "every-two-months", label: "Every 2 months" },
  { value: "quarterly", label: "Quarterly (every 3 months)" },
  { value: "yearly", label: "Yearly" },
] as const;

export type RepeatPreset = (typeof repeatPresets)[number]["value"];
export type RepeatSelection = "" | RepeatPreset | `custom:${Frequency}:${number}`;
export type RepeatRule = Pick<Recurrence, "frequency" | "interval" | "weekdays">;
export type RepeatOption = { value: RepeatSelection; label: string };

const weekdaysOnly = [1, 2, 3, 4, 5];
const weekendsOnly = [0, 6];
const sorted = (days: number[]) => [...days].sort((left, right) => left - right);
const sameDays = (left: number[] | undefined, right: number[]) =>
  left !== undefined && JSON.stringify(sorted(left)) === JSON.stringify(right);

export function repeatSelectionFor(recurrence?: Pick<Recurrence, "frequency" | "interval" | "weekdays">): RepeatSelection {
  if (!recurrence) return "";
  const days = recurrence.weekdays;
  if (recurrence.frequency === "weekly" && recurrence.interval === 1 && sameDays(days, weekdaysOnly)) return "weekdays";
  if (recurrence.frequency === "weekly" && recurrence.interval === 1 && sameDays(days, weekendsOnly)) return "weekends";
  if (recurrence.frequency === "daily" && recurrence.interval === 1) return "daily";
  if (recurrence.frequency === "daily" && recurrence.interval === 2) return "every-other-day";
  if (recurrence.frequency === "weekly" && recurrence.interval === 1) return "weekly";
  if (recurrence.frequency === "weekly" && recurrence.interval === 2) return "biweekly";
  if (recurrence.frequency === "monthly" && recurrence.interval === 1) return "monthly";
  if (recurrence.frequency === "monthly" && recurrence.interval === 2) return "every-two-months";
  if (recurrence.frequency === "monthly" && recurrence.interval === 3) return "quarterly";
  if (recurrence.frequency === "yearly" && recurrence.interval === 1) return "yearly";
  return `custom:${recurrence.frequency}:${recurrence.interval}`;
}

export function repeatOptionsFor(recurrence?: Pick<Recurrence, "frequency" | "interval" | "weekdays">): RepeatOption[] {
  const options: RepeatOption[] = [
    { value: "", label: "Never" },
    ...repeatPresets.map(preset => ({ ...preset })),
  ];
  const selection = repeatSelectionFor(recurrence);
  if (selection.startsWith("custom:")) {
    const [, frequency, interval] = selection.split(":");
    const unit = frequency === "daily" ? "day" : frequency === "weekly" ? "week" : frequency === "monthly" ? "month" : "year";
    options.push({ value: selection as RepeatSelection, label: `Custom · every ${interval} ${unit}${interval === "1" ? "" : "s"}` });
  }
  return options;
}

export function repeatLabelFor(recurrence: Pick<Recurrence, "frequency" | "interval" | "weekdays">): string {
  const selection = repeatSelectionFor(recurrence);
  return repeatOptionsFor(recurrence).find(option => option.value === selection)?.label ?? "Custom repeat";
}

export function defaultWeekdaysForRepeat(selection: RepeatSelection): number[] | undefined {
  if (selection === "weekdays") return [...weekdaysOnly];
  if (selection === "weekends") return [...weekendsOnly];
  return undefined;
}

export function repeatUsesWeekdayPicker(selection: RepeatSelection): boolean {
  return selection === "weekly" || selection === "biweekly" || selection.startsWith("custom:weekly:");
}

export function recurrenceForRepeat(selection: RepeatSelection, selectedWeekdays: number[]): RepeatRule | undefined {
  if (!selection) return undefined;
  let frequency: Frequency;
  let interval: number;
  let weekdays: number[] | undefined;

  switch (selection) {
    case "daily": frequency = "daily"; interval = 1; break;
    case "every-other-day": frequency = "daily"; interval = 2; break;
    case "weekdays": frequency = "weekly"; interval = 1; weekdays = [...weekdaysOnly]; break;
    case "weekends": frequency = "weekly"; interval = 1; weekdays = [...weekendsOnly]; break;
    case "weekly": frequency = "weekly"; interval = 1; break;
    case "biweekly": frequency = "weekly"; interval = 2; break;
    case "monthly": frequency = "monthly"; interval = 1; break;
    case "every-two-months": frequency = "monthly"; interval = 2; break;
    case "quarterly": frequency = "monthly"; interval = 3; break;
    case "yearly": frequency = "yearly"; interval = 1; break;
    default: {
      const match = selection.match(/^custom:(daily|weekly|monthly|yearly):(\d+)$/);
      if (!match) return undefined;
      frequency = match[1] as Frequency;
      interval = Number(match[2]);
      if (!Number.isSafeInteger(interval) || interval < 1) return undefined;
    }
  }

  if (frequency === "weekly" && !weekdays) weekdays = selectedWeekdays.length ? sorted(selectedWeekdays) : undefined;
  return { frequency, interval, weekdays };
}
