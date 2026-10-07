import { validOutlineDate, type OutlineItem, type OutlineOptions } from "./outline-parser.ts";

export const MAX_BULK_IMPORT_ITEMS = 1_000;
export const MAX_BULK_IMPORT_FILES = 10;
export const MAX_BULK_IMPORT_BYTES = 50 * 1024 * 1024;
const titleHeaders = new Set(["title", "name", "task", "event", "summary", "subject", "item", "item title", "task title", "task name", "event title", "event name"]);
const dateHeaders = new Set(["date", "due date", "due", "deadline", "start date", "event date"]);
const eventTypes = new Set(["event", "calendar", "calendar event", "meeting", "appointment"]);
const taskTypes = new Set(["task", "todo", "to do", "deadline", "assignment"]);

function rowsFromDelimited(source: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === delimiter) { row.push(field.trim()); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(field.trim()); field = "";
      if (row.some(cell => cell)) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error("The delimited file has an unclosed quoted field.");
  row.push(field.trim());
  if (row.some(cell => cell)) rows.push(row);
  return rows;
}

function normalizedHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function column(headers: string[], names: string[]): number {
  return headers.findIndex(header => names.includes(header));
}

function dateCell(value: string, options: OutlineOptions): { date: string; warning?: string } {
  const raw = value.trim();
  if (validOutlineDate(raw)) return { date: raw };
  const numeric = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|20\d{2})$/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    if (!options.dateOrder && first <= 12 && second <= 12 && first !== second) return { date: "", warning: `Ambiguous date “${raw}”; set Month/Day or Day/Month before previewing.` };
    const dmy = options.dateOrder === "dmy" || (!options.dateOrder && first > 12);
    const year = Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    const date = `${year}-${String(dmy ? second : first).padStart(2, "0")}-${String(dmy ? first : second).padStart(2, "0")}`;
    return validOutlineDate(date) ? { date } : { date: "", warning: `Invalid date “${raw}”.` };
  }
  return { date: "", warning: raw ? `Unsupported date “${raw}”; use YYYY-MM-DD or an unambiguous numeric date.` : "Date is missing." };
}

function timeCell(value: string): string {
  const raw = value.trim().toLowerCase().replace(/\./g, "");
  const twentyFourHour = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHour && Number(twentyFourHour[1]) <= 23 && Number(twentyFourHour[2]) <= 59) return `${twentyFourHour[1].padStart(2, "0")}:${twentyFourHour[2]}`;
  const twelveHour = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (twelveHour && Number(twelveHour[1]) >= 1 && Number(twelveHour[1]) <= 12) {
    const hour = Number(twelveHour[1]) % 12 + (twelveHour[3] === "pm" ? 12 : 0);
    return `${String(hour).padStart(2, "0")}:${twelveHour[2] || "00"}`;
  }
  return "";
}

/** Parses a CSV/TSV file with a header row into editable task and event candidates. */
export async function parseBulkDelimitedFile(file: File, options: OutlineOptions): Promise<OutlineItem[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (source.length > 5_000_000) throw new Error(`${file.name} is larger than the 5 MB table limit.`);
    const delimiter = file.name.toLowerCase().endsWith(".tsv") ? "\t" : ",";
    const rows = rowsFromDelimited(source, delimiter);
    if (rows.length < 2) throw new Error(`${file.name} needs a header row and at least one data row.`);
    if (rows.length - 1 > MAX_BULK_IMPORT_ITEMS) throw new Error(`${file.name} contains more than 1,000 rows.`);
    const headers = rows[0].map(normalizedHeader);
    const titleIndex = column(headers, [...titleHeaders]);
    const dateIndex = column(headers, [...dateHeaders]);
    if (titleIndex < 0 || dateIndex < 0) throw new Error(`${file.name} needs a title/name column and a date, due date, or start date column.`);
    const typeIndex = column(headers, ["type", "kind", "item type"]);
    const timeIndex = column(headers, ["time", "due time", "start time"]);
    const endTimeIndex = column(headers, ["end time"]);
    const endDateIndex = column(headers, ["end date"]);
    const notesIndex = column(headers, ["notes", "description", "details"]);
    const priorityIndex = column(headers, ["priority"]);
    const startDateColumn = headers.includes("start date") || headers.includes("event date");
    return rows.slice(1).map((row, index) => {
      const get = (at: number) => at < 0 ? "" : (row[at] || "").trim();
      const title = get(titleIndex).slice(0, 240);
      const explicitType = get(typeIndex).toLowerCase().replace(/[-_]/g, " ");
      const kind = eventTypes.has(explicitType) || (!taskTypes.has(explicitType) && startDateColumn) ? "event" : "task";
      const { date, warning } = dateCell(get(dateIndex), options);
      const time = timeCell(get(timeIndex));
      const endTime = timeCell(get(endTimeIndex));
      const endDateRaw = get(endDateIndex);
      const parsedEndDate = endDateRaw ? dateCell(endDateRaw, options) : undefined;
      const endDate = parsedEndDate?.date || date;
      const priorityRaw = get(priorityIndex).toLowerCase();
      const priority = priorityRaw === "high" || priorityRaw === "medium" ? priorityRaw : "low";
      const warnings = warning ? [warning] : [];
      if (!title) warnings.push("Title is missing.");
      if (explicitType && !eventTypes.has(explicitType) && !taskTypes.has(explicitType)) warnings.push(`Unrecognized type “${explicitType}”; review the suggested ${kind}.`);
      if (parsedEndDate?.warning) warnings.push(parsedEndDate.warning);
      if (priorityRaw && !["low", "medium", "high"].includes(priorityRaw)) warnings.push(`Unrecognized priority “${priorityRaw}”; defaulted to Low.`);
      if (kind === "event" && Boolean(time) !== Boolean(endTime)) warnings.push("Provide both start and end times, or leave both blank for an all-day event.");
      if (get(timeIndex) && !time || get(endTimeIndex) && !endTime) warnings.push("Unrecognized time format; use HH:MM or 2:30 PM.");
      return {
        id: `${file.name}-row-${index + 2}`, selected: Boolean(title && date && (!warning)), kind, title, date, endDate,
        time, endTime, weekdays: [], until: "", source: `${file.name} · row ${index + 2}: ${row.join(" | ").slice(0, 1600)}`,
        warnings, notes: get(notesIndex).slice(0, 5000), priority,
      };
    });
  } finally { bytes.fill(0); }
}
