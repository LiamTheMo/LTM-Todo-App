import { addDays, localDate, parseLocalDate } from "./domain.ts";

export const MAX_OUTLINE_CHARACTERS = 500_000;
export const MAX_OUTLINE_ITEMS = 250;
export type OutlineBlock = { text: string; heading?: boolean; page?: number };
export type OutlineOptions = {
  year: number; dateOrder?: "mdy" | "dmy"; referenceDate?: string;
  termStart?: string; termEnd?: string; today?: string;
};
export type OutlineItem = {
  id: string; selected: boolean; kind: "task" | "event"; title: string;
  date: string; endDate: string; time: string; endTime: string;
  weekdays: number[]; until: string; source: string; page?: number;
  warnings: string[];
};
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthPattern = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const weekdayPattern = "(?:Sun(?:day)?|Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?)\\.?";
const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const assessment = /\b(?:assignments?|essays?|projects?|reports?|quizzes|quiz|exams?|midterms?|finals?|tests?|presentations?|submissions?|submit|deadlines?|due|readings?|homework|labs?|lectures?|tutorials?|seminars?|classes|class|workshops?|meetings?|breaks?|holidays?)\b/i;
const deadline = /\b(?:due|deadline|submit|submission|assignment|essay|project|report|homework|reading)\b/i;
const eventWord = /\b(?:exams?|midterms?|quizzes|quiz|tests?|presentations?|lectures?|tutorials?|seminars?|classes|class|workshops?|meetings?|breaks?|holidays?)\b/i;
const timePattern = /\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:[-–—]|to)\s*(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b|\b(\d{1,2}):([0-5]\d)\s*(a\.?m\.?|p\.?m\.?)?\b|\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)\b/gi;
export function validOutlineDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parseLocalDate(value).getTime()) && addDays(value, 0) === value;
}
function dateValue(year: number, month: number, day: number): string {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return validOutlineDate(value) ? value : "";
}
function clock(hour: string, minute = "00", suffix = "") {
  let h = Number(hour);
  if (suffix) {
    if (h < 1 || h > 12) return "";
    h = h % 12 + (/^p/i.test(suffix) ? 12 : 0);
  }
  return h <= 23 ? `${String(h).padStart(2, "0")}:${minute}` : "";
}
export function outlineTimes(text: string): { time: string; endTime: string; ranges: string[]; warning?: string } {
  const matches = [...text.matchAll(timePattern)];
  const range = matches.find(match => match[1]);
  if (range) return { time: clock(range[1], range[2], range[3] || range[6]), endTime: clock(range[4], range[5], range[6]), ranges: matches.map(match => match[0]) };
  const values = matches.map(match => match[7] ? clock(match[7], match[8], match[9]) : clock(match[10], "00", match[11]));
  return { time: values[0] || "", endTime: values[1] || "", ranges: matches.map(match => match[0]),
    warning: matches.length > 2 ? "Multiple times found; verify the selected times." : undefined };
}
function datesIn(text: string, options: OutlineOptions) {
  const results: { value: string; raw: string; index: number }[] = [];
  const warnings: string[] = [];
  const occupied: [number, number][] = [];
  const add = (match: RegExpMatchArray, year: number, month: number, day: number, inferred: boolean) => {
    const index = match.index ?? 0;
    if (occupied.some(([start, end]) => index < end && index + match[0].length > start)) return;
    occupied.push([index, index + match[0].length]);
    const value = dateValue(year, month, day);
    if (!value) warnings.push(`Invalid date: ${match[0]}.`);
    if (inferred) warnings.push(`Year taken from ${options.year}; verify the semester.`);
    results.push({ value, raw: match[0], index });
  };
  for (const match of text.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) add(match, +match[1], +match[2], +match[3], false);
  for (const match of text.matchAll(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, "gi"))) {
    add(match, match[3] ? +match[3] : options.year, months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1, +match[2], !match[3]);
  }
  for (const match of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})(?:,?\\s+(20\\d{2}))?\\b`, "gi"))) {
    add(match, match[3] ? +match[3] : options.year, months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1, +match[1], !match[3]);
  }
  for (const match of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](20\d{2}|\d{2}))?\b/g)) {
    if (+match[1] <= 12 && +match[2] <= 12 && !options.dateOrder && +match[1] !== +match[2]) {
      warnings.push(`Ambiguous date ${match[0]}; choose Month/Day or Day/Month and parse again.`);
      add(match, 0, 0, 0, false);
    } else {
      const dmy = options.dateOrder === "dmy" || !options.dateOrder && +match[1] > 12;
      const year = match[3] ? (+match[3] < 100 ? 2000 + +match[3] : +match[3]) : options.year;
      add(match, year, +(dmy ? match[2] : match[1]), +(dmy ? match[1] : match[2]), !match[3]);
    }
  }
  if (!results.length) {
    const relative = text.match(new RegExp(`\\b(today|tomorrow|next\\s+${weekdayPattern})\\b`, "i"));
    if (relative) {
      let date = "";
      if (options.referenceDate && validOutlineDate(options.referenceDate)) {
        const ref = options.referenceDate;
        if (/^today$/i.test(relative[0])) date = ref;
        else if (/^tomorrow$/i.test(relative[0])) date = addDays(ref, 1);
        else {
          const weekday = dayNames.indexOf(relative[0].split(/\s+/)[1].slice(0, 3).toLowerCase());
          date = addDays(ref, (weekday - parseLocalDate(ref).getDay() + 7) % 7 || 7);
          warnings.push("“Next” uses the next matching weekday after the reference date; verify it.");
        }
      } else warnings.push("Relative date needs the document's reference date.");
      results.push({ value: date, raw: relative[0], index: relative.index ?? 0 });
    }
  }
  const week = text.match(new RegExp(`\\bWeek\\s+(\\d{1,2})(?:\\s*[:,–-]?\\s*(${weekdayPattern}))?`, "i"));
  if (!results.length && week) {
    let date = "";
    if (options.termStart && validOutlineDate(options.termStart) && week[2] && +week[1] > 0) {
      const firstMonday = addDays(options.termStart, -(parseLocalDate(options.termStart).getDay() + 6) % 7);
      const weekday = dayNames.indexOf(week[2].slice(0, 3).toLowerCase());
      date = addDays(firstMonday, (+week[1] - 1) * 7 + (weekday + 6) % 7);
      warnings.push("Week 1 is the Monday-based week containing semester start; verify course week numbering.");
    } else warnings.push("Week-based date needs semester start and an explicit weekday; choose a date in review.");
    results.push({ value: date, raw: week[0], index: week.index ?? 0 });
  }
  return { dates: results.sort((a, b) => a.index - b.index), warnings: [...new Set(warnings)] };
}

/** Conservative deterministic extraction. All candidates remain editable before any persistence. */
export function parseOutline(blocks: OutlineBlock[], options: OutlineOptions): OutlineItem[] {
  if (!Number.isInteger(options.year) || options.year < 2000 || options.year > 2099) throw new Error("Choose a year from 2000 to 2099.");
  if (blocks.reduce((total, block) => total + block.text.length, 0) > MAX_OUTLINE_CHARACTERS) throw new Error("Outline text is too large (maximum 500,000 characters).");
  const items: OutlineItem[] = [];
  let heading = "";
  let previous = "";
  for (const [index, block] of blocks.entries()) {
    const text = block.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const { dates, warnings } = datesIn(text, options);
    const days = [...new Set([...text.matchAll(new RegExp(`\\b(${weekdayPattern})\\b`, "gi"))].map(match => dayNames.indexOf(match[1].slice(0, 3).toLowerCase())))];
    const weekly = days.length > 0 && !dates.length && /\b(?:every|weekly|lectures?|classes|tutorials?|seminars?)\b/i.test(text);
    const dateLabelOnly = /^(?:due(?: date)?|deadline|submission date)\s*[:–-]?\s/i.test(text);
    const context = assessment.test(text) && !dateLabelOnly ? text : assessment.test(previous) ? previous : heading || text;
    if ((!dates.length && !weekly && !/\b(?:TBA|TBD|to be announced)\b/i.test(text)) || !assessment.test(`${text} ${context}`)) {
      if (block.heading || text.length < 100 && /\b(?:schedule|assessments|assignments|exams|deadlines|important dates)\b/i.test(text)) heading = text;
      previous = text;
      continue;
    }
    const timing = outlineTimes(text);
    const kind = deadline.test(context) && !(/\b(?:exam|midterm|quiz|test|lecture|tutorial)\b/i.test(text) && !/\b(?:due|submit|deadline)\b/i.test(text)) ? "task" : eventWord.test(context) || weekly ? "event" : "task";
    let date = dates[0]?.value || "";
    if (weekly) {
      if (options.termStart && validOutlineDate(options.termStart)) {
        date = options.termStart > (options.today || localDate(new Date())) ? options.termStart : (options.today || localDate(new Date()));
        for (let offset = 0; offset < 7; offset++) if (days.includes(parseLocalDate(addDays(date, offset)).getDay())) { date = addDays(date, offset); break; }
        warnings.push("Recurring classes begin on the next matching day within the semester; verify holidays separately.");
      } else warnings.push("Recurring classes need semester start.");
      if (!options.termEnd || !validOutlineDate(options.termEnd)) warnings.push("Recurring classes need semester end.");
    }
    if (dates.length > 2) warnings.push("Multiple dates found; verify the selected date range.");
    if (timing.warning) warnings.push(timing.warning);
    if (kind === "event" && timing.time && !timing.endTime) warnings.push("Add an end time, or clear the start time for an all-day event.");
    let title = text;
    for (const part of [...dates.map(date => date.raw), ...timing.ranges]) title = title.replace(part, " ");
    title = title.replace(/\b(?:due(?:\s+on)?|deadline|at|on|from|until|to)\b\s*[:–-]?/gi, " ").replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, "").replace(/\s+/g, " ").trim();
    if (!assessment.test(title) && assessment.test(context)) title = `${context.replace(/[|:–-]+$/g, "").trim()}${title ? ` — ${title}` : ""}`;
    if (!title) title = context || "Course item";
    const item: OutlineItem = { id: `outline-${index}`, selected: Boolean(date) && (!weekly || Boolean(options.termEnd)), kind,
      title: title.slice(0, 240), date, endDate: dates[1]?.value || date, time: timing.time, endTime: timing.endTime,
      weekdays: weekly ? days : [], until: weekly ? options.termEnd || "" : "", source: text.slice(0, 2000), page: block.page, warnings: [...new Set(warnings)] };
    if (!items.some(old => old.title.toLowerCase() === item.title.toLowerCase() && old.date === item.date && old.time === item.time && old.kind === item.kind)) items.push(item);
    if (items.length > MAX_OUTLINE_ITEMS) throw new Error("More than 250 items found. Import a smaller section of the outline.");
    previous = text;
  }
  return items;
}
