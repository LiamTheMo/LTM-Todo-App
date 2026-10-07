import { addDays, localDate, parseLocalDate } from "./domain.ts";

export const MAX_OUTLINE_CHARACTERS = 5_000_000;
export const MAX_PASTED_TEXT_CHARACTERS = 500_000;
export const MAX_OUTLINE_ITEMS = 1_000;
export type OutlineBlock = { text: string; heading?: boolean; page?: number };
export type OutlineOptions = {
  year?: number; dateOrder?: "mdy" | "dmy"; referenceDate?: string; today?: string;
};
export type OutlineItem = {
  id: string; selected: boolean; kind: "task" | "event"; title: string;
  date: string; endDate: string; time: string; endTime: string;
  weekdays: number[]; until: string; source: string; page?: number;
  warnings: string[]; notes?: string; priority?: "low" | "medium" | "high";
};
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthPattern = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?";
const weekdayPattern = "(?:Sun(?:day)?|Mon(?:day)?|Tue(?:s(?:day)?)?|Wed(?:nesday)?|Thu(?:rs(?:day)?)?|Fri(?:day)?|Sat(?:urday)?)\\.?";
const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const assessment = /\b(?:assignments?|essays?|projects?|reports?|quizzes|quiz|exams?|midterms?|finals?|tests?|presentations?|submissions?|submit|deadlines?|due|readings?|homework|labs?|lectures?|tutorials?|seminars?|classes|class|workshops?|meetings?|breaks?|holidays?)\b/i;
const deadline = /\b(?:due|deadline|submit|submission|assignment|essay|project|report|homework|reading)\b/i;
const eventWord = /\b(?:exams?|midterms?|quizzes|quiz|tests?|presentations?|lectures?|tutorials?|seminars?|classes|class|workshops?|meetings?|breaks?|holidays?)\b/i;
const genericHeading = /^(?:(?:course|class|weekly|upcoming|important|key)\s+)?(?:outline|overview|schedule|calendar|syllabus|assignments?|assessments?|important dates|key dates|deadlines?|due dates|course requirements|course objectives|evaluation|grading(?: breakdown| policy)?|exams?|instructions?|requirements?)(?:\s+(?:overview|schedule|(?:and|&|\/)\s+(?:assignments?|assessments?|exams?|deadlines?|due dates|important dates|key dates)))?$/i;
const bareAssessmentHeading = /^(?:assignment|assessment|homework|essay|paper|project|report|quiz|exam|midterm|final(?:\s+exam)?|test|presentation|reading|lab)(?:\s+(?:no\.?\s*)?#?\s*\d+)?$/i;
const timePattern = /\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:[-–—]|to)\s*(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b|\b(\d{1,2}):([0-5]\d)\s*(a\.?m\.?|p\.?m\.?)?\b|\b(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)\b/gi;
function cleanTitleCandidate(source: string, dates: { raw: string; index: number }[], timeRanges: string[]): string {
  let title = source;
  const timeParts: { raw: string; index: number }[] = [];
  let timeSearchFrom = 0;
  for (const raw of timeRanges) {
    const index = source.indexOf(raw, timeSearchFrom);
    if (index >= 0) {
      timeParts.push({ raw, index });
      timeSearchFrom = index + raw.length;
    }
  }
  const parts = [
    ...dates.map(date => ({ raw: date.raw, index: date.index })),
    ...timeParts,
  ].filter(part => part.index >= 0).sort((a, b) => b.index - a.index);
  for (const part of parts) {
    const start = part.index;
    if (title.slice(start, start + part.raw.length) !== part.raw) continue;
    const prefix = title.slice(0, start);
    const connector = prefix.match(/(?:^|\s)(?:due(?:\s+(?:date|on|by))?|deadline|submission\s+date|submit\s+by|by|at|on|from|until|to)\s*[:–—-]?\s*$/i);
    const removeFrom = connector ? (connector.index ?? 0) + (connector[0].startsWith(" ") ? 1 : 0) : start;
    title = `${title.slice(0, removeFrom)} ${title.slice(start + part.raw.length)}`;
  }
  title = title
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[•*·]+\s*/, "")
    .replace(/\b(?:TBA|TBD|to be announced)\b/gi, " ")
    .replace(/^(?:due(?:\s+(?:date|on|by))?|deadline|submission\s+date)\s*[:–—-]?\s*/i, " ")
    .replace(/^(?:(?:assignment|task|assessment)\s+)?(?:name|title|topic|prompt)\s*[:–—-]\s*/i, " ")
    .replace(/\s+(?:at|by|on|from|until|to)\s*$/i, " ")
    .replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, "")
    .replace(/\s+/g, " ").trim();
  return title;
}
function titleFieldValue(text: string, dates: { raw: string; index: number }[], timeRanges: string[]): string {
  if (!/^(?:(?:assignment|task|assessment)\s+)?(?:name|title|topic|prompt)\s*[:–—-]/i.test(text)) return "";
  return cleanTitleCandidate(text, dates, timeRanges);
}
function usefulTitle(value: string): boolean {
  return Boolean(value) && !genericHeading.test(value) && !/^(?:due|deadline|submission\s+date|date|time)$/i.test(value);
}
function assignmentTitle(header: string, name: string): string {
  if (!name) return header;
  if (!header || header.toLowerCase().includes(name.toLowerCase())) return name;
  if (name.toLowerCase().includes(header.toLowerCase())) return name;
  return bareAssessmentHeading.test(header) ? `${header} — ${name}` : name;
}
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
  const inferredYear = options.year || new Date().getFullYear();
  const results: { value: string; raw: string; index: number }[] = [];
  const warnings: string[] = [];
  const occupied: [number, number][] = [];
  const add = (match: RegExpMatchArray, year: number, month: number, day: number, inferred: boolean) => {
    const index = match.index ?? 0;
    if (occupied.some(([start, end]) => index < end && index + match[0].length > start)) return;
    occupied.push([index, index + match[0].length]);
    const value = dateValue(year, month, day);
    if (!value) warnings.push(`Invalid date: ${match[0]}.`);
    if (inferred) warnings.push(`Year inferred as ${year}; verify it against the source.`);
    results.push({ value, raw: match[0], index });
  };
  for (const match of text.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) add(match, +match[1], +match[2], +match[3], false);
  for (const match of text.matchAll(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`, "gi"))) {
    add(match, match[3] ? +match[3] : inferredYear, months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1, +match[2], !match[3]);
  }
  for (const match of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})(?:,?\\s+(20\\d{2}))?\\b`, "gi"))) {
    add(match, match[3] ? +match[3] : inferredYear, months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1, +match[1], !match[3]);
  }
  for (const match of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](20\d{2}|\d{2}))?\b/g)) {
    if (+match[1] <= 12 && +match[2] <= 12 && !options.dateOrder && +match[1] !== +match[2]) {
      warnings.push(`Ambiguous date ${match[0]}; choose Month/Day or Day/Month and parse again.`);
      add(match, 0, 0, 0, false);
    } else {
      const dmy = options.dateOrder === "dmy" || !options.dateOrder && +match[1] > 12;
      const year = match[3] ? (+match[3] < 100 ? 2000 + +match[3] : +match[3]) : inferredYear;
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
    warnings.push("Week-number dates need a real date from the source; choose the date in review.");
    results.push({ value: "", raw: week[0], index: week.index ?? 0 });
  }
  return { dates: results.sort((a, b) => a.index - b.index), warnings: [...new Set(warnings)] };
}

/** Conservative deterministic extraction. All candidates remain editable before any persistence. */
export function parseOutline(blocks: OutlineBlock[], options: OutlineOptions): OutlineItem[] {
  if (blocks.reduce((total, block) => total + block.text.length, 0) > MAX_OUTLINE_CHARACTERS) throw new Error("Import text is too large (maximum 5,000,000 characters).");
  const items: OutlineItem[] = [];
  let itemHeader = "";
  let itemName = "";
  let previous = "";
  for (const [index, block] of blocks.entries()) {
    const text = block.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const { dates, warnings } = datesIn(text, options);
    const timing = outlineTimes(text);
    const currentTitle = cleanTitleCandidate(text, dates, timing.ranges);
    const fieldTitle = titleFieldValue(text, dates, timing.ranges);
    const dateLabelOnly = /^(?:due(?:\s+date)?|deadline|submission\s+date)\s*[:–—-]?\s/i.test(text) && !usefulTitle(currentTitle);
    const sectionHeading = genericHeading.test(currentTitle) || /^(?:week|unit|module|chapter)\s+\d+\b/i.test(currentTitle);
    const currentHeading = block.heading && usefulTitle(currentTitle) && !sectionHeading ? currentTitle : "";
    const days = [...new Set([...text.matchAll(new RegExp(`\\b(${weekdayPattern})\\b`, "gi"))].map(match => dayNames.indexOf(match[1].slice(0, 3).toLowerCase())))];
    const weekly = days.length > 0 && !dates.length && /\b(?:every|weekly|lectures?|classes|tutorials?|seminars?)\b/i.test(text);
    const context = [dateLabelOnly ? "" : text, fieldTitle, itemName, itemHeader, currentHeading, previous].filter(Boolean).join(" ");
    const hasItemContext = Boolean(fieldTitle || itemName || itemHeader || currentHeading);
    if ((!dates.length && !weekly && !/\b(?:TBA|TBD|to be announced)\b/i.test(text)) || (!assessment.test(`${text} ${context}`) && !hasItemContext)) {
      if (sectionHeading) {
        itemHeader = "";
        itemName = "";
      } else if (fieldTitle && usefulTitle(fieldTitle)) {
        itemName = fieldTitle;
      } else if (currentHeading) {
        if (itemHeader && !itemName && (bareAssessmentHeading.test(itemHeader) || assessment.test(itemHeader))) itemName = currentHeading;
        else { itemHeader = currentHeading; itemName = ""; }
      } else if (assessment.test(text) && usefulTitle(currentTitle)) {
        itemHeader = currentTitle;
        itemName = "";
      } else if (itemHeader && bareAssessmentHeading.test(itemHeader) && usefulTitle(currentTitle) &&
        text.length <= 160 && !/^(?:instructions?|description|worth\b|weight\b|points?\b|value\b|write\b|read\b|complete\b|submit\b|upload\b|review\b|discuss\b|describe\b|compare\b|explain\b|answer\b|choose\b|select\b|include\b|students?\b|you\b)/i.test(text)) {
        itemName = currentTitle;
      }
      previous = text;
      continue;
    }
    const kind = deadline.test(context) && !(/\b(?:exam|midterm|quiz|test|lecture|tutorial)\b/i.test(text) && !/\b(?:due|submit|deadline)\b/i.test(text)) ? "task" : eventWord.test(context) || weekly ? "event" : "task";
    let date = dates[0]?.value || "";
    if (weekly) {
      date = options.today || localDate(new Date());
      for (let offset = 0; offset < 7; offset++) if (days.includes(parseLocalDate(addDays(date, offset)).getDay())) { date = addDays(date, offset); break; }
      warnings.push("Review the start date and set a repeat-until date for this weekly event.");
    }
    if (dates.length > 2) warnings.push("Multiple dates found; verify the selected date range.");
    if (timing.warning) warnings.push(timing.warning);
    if (kind === "event" && timing.time && !timing.endTime) warnings.push("Add an end time, or clear the start time for an all-day event.");
    const previousTitle = assessment.test(previous) ? cleanTitleCandidate(previous, [], []) : "";
    const headerTitle = itemName ? assignmentTitle(itemHeader, itemName) : itemHeader || currentHeading;
    const title = usefulTitle(currentTitle) && !dateLabelOnly ? currentTitle
      : fieldTitle ? assignmentTitle(itemHeader, fieldTitle)
        : headerTitle || (usefulTitle(previousTitle) ? previousTitle : "Course item");
    const item: OutlineItem = { id: `outline-${index}`, selected: Boolean(date), kind,
      title: title.slice(0, 240), date, endDate: dates[1]?.value || date, time: timing.time, endTime: timing.endTime,
      weekdays: weekly ? days : [], until: "", source: text.slice(0, 2000), page: block.page, warnings: [...new Set(warnings)], priority: "low", notes: "" };
    if (!items.some(old => old.title.toLowerCase() === item.title.toLowerCase() && old.date === item.date && old.time === item.time && old.kind === item.kind)) items.push(item);
    if (items.length > MAX_OUTLINE_ITEMS) throw new Error(`More than ${MAX_OUTLINE_ITEMS.toLocaleString()} items found. Split the source into smaller imports.`);
    itemHeader = "";
    itemName = "";
    previous = "";
  }
  return items;
}
