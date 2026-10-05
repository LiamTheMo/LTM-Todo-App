import test from "node:test";
import assert from "node:assert/strict";
import { parseOutline, outlineTimes } from "../lib/outline-parser.ts";
import { importOutlineItems, isOutlineDuplicate, outlineItemError } from "../lib/outline-import.ts";
import { textOutlineBlocks, readOutlineDocument } from "../lib/outline-document.ts";
import { emptyData, newEntity } from "../lib/domain.ts";
import { calendarEventOccurrences } from "../lib/calendar-domain.ts";

const options = { year: 2026, today: "2026-10-05" };
const parse = (text, extra = {}) => parseOutline(textOutlineBlocks(text), { ...options, ...extra });
const destination = data => ({ calendarId: data.calendars[0].id, timeZone: "America/Edmonton" });

test("outline dates preserve date-only deadlines and exact explicit times", () => {
  const items = parse("Assignment 2 — due October 20, 2026 at 11:59 PM\nEssay — due 22 November 2026\nFinal exam — 2026-12-03 2:30–3:50 PM");
  assert.equal(items.length, 3);
  assert.equal(items[0].title, "Assignment 2");
  assert.equal(items[0].date, "2026-10-20");
  assert.equal(items[0].time, "23:59");
  assert.equal(items[1].time, "");
  assert.equal(items[2].kind, "event");
  assert.equal(items[2].time, "14:30");
  assert.equal(items[2].endTime, "15:50");
});

test("heading and adjacent assignment title give context to a separate date line", () => {
  const items = parseOutline([{ text: "Assignment 2", heading: true }, { text: "Due: October 20", page: 2 }], options);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Assignment 2");
  assert.equal(items[0].page, 2);
  assert.ok(items[0].warnings.some(warning => warning.includes("Year")));
});

test("assignment name fields and descriptive headers become task titles", () => {
  const named = parseOutline([
    { text: "Assignments", heading: true },
    { text: "Assignment 2", heading: true },
    { text: "Assignment name: Critical Reflection on Digital Privacy" },
    { text: "Due date: October 20" },
  ], options);
  assert.equal(named.length, 1);
  assert.equal(named[0].title, "Assignment 2 — Critical Reflection on Digital Privacy");

  const headed = parseOutline([
    { text: "Essay: Rethinking the Future", heading: true },
    { text: "October 22" },
  ], options);
  assert.equal(headed.length, 1);
  assert.equal(headed[0].title, "Essay: Rethinking the Future");

  const nearbyName = parseOutline([
    { text: "Assignment 3", heading: true },
    { text: "Identity and Responsibility" },
    { text: "Due date: October 24" },
  ], options);
  assert.equal(nearbyName.length, 1);
  assert.equal(nearbyName[0].title, "Assignment 3 — Identity and Responsibility");
});

test("title cleanup preserves ordinary words and ignores section and due-date labels", () => {
  const titled = parse("Assignment 3: Reflection on Learning due October 20")[0];
  assert.equal(titled.title, "Assignment 3: Reflection on Learning");
  const generic = parseOutline([
    { text: "Assignments & Assessments", heading: true },
    { text: "Due: October 20" },
  ], options)[0];
  assert.equal(generic.title, "Course item");
});

test("numeric date ambiguity is unresolved until a date order is chosen", () => {
  const ambiguous = parse("Assignment 2 due 10/11")[0];
  assert.equal(ambiguous.date, "");
  assert.equal(ambiguous.selected, false);
  assert.ok(ambiguous.warnings.some(warning => warning.includes("Ambiguous")));
  assert.equal(parse("Assignment 2 due 10/11", { dateOrder: "mdy" })[0].date, "2026-10-11");
  assert.equal(parse("Assignment 2 due 10/11", { dateOrder: "dmy" })[0].date, "2026-11-10");
  assert.equal(parse("Assignment 2 due 22/11")[0].date, "2026-11-22");
});

test("impossible and missing dates remain unselected; no automatic midnight or date guessing", () => {
  assert.equal(parse("Assignment due February 30, 2026")[0].selected, false);
  assert.equal(parse("Final exam TBD")[0].date, "");
  assert.deepEqual(parse("Office contact updated October 10, 2026"), []);
});

test("relative dates require explicit document reference date, rather than today's date", () => {
  assert.equal(parse("Assignment due tomorrow")[0].date, "");
  assert.equal(parse("Assignment due tomorrow", { referenceDate: "2026-10-15" })[0].date, "2026-10-16");
  assert.equal(parse("Assignment due next Friday", { referenceDate: "2026-10-09" })[0].date, "2026-10-16");
});

test("week numbering requires semester start and weekday and has an explicit assumption note", () => {
  assert.equal(parse("Assignment due Week 5")[0].selected, false);
  const item = parse("Assignment due Week 5 Monday", { termStart: "2026-09-09" })[0];
  assert.equal(item.date, "2026-10-05");
  assert.ok(item.warnings.some(warning => warning.includes("Monday-based")));
});

test("bounded weekly classes begin on a matching remaining semester day", () => {
  const item = parse("Lectures every Monday and Wednesday 2:30–3:50 PM", { termStart: "2026-09-01", termEnd: "2026-12-10" })[0];
  assert.deepEqual(item.weekdays, [1, 3]);
  assert.equal(item.date, "2026-10-05");
  assert.equal(item.until, "2026-12-10");
  const data = emptyData();
  const imported = importOutlineItems(data, [item], destination(data), options.today).data;
  assert.deepEqual(calendarEventOccurrences(imported, "2026-10-05", "2026-10-12").map(event => event.occurrenceDate), ["2026-10-05", "2026-10-07"]);
  assert.equal(calendarEventOccurrences(imported, "2026-12-11", "2026-12-20").length, 0);
  assert.equal(parse("Lectures every Monday 2:30–3:50 PM")[0].selected, false);
});

test("explicit two-date all-day event uses an inclusive last date in review", () => {
  const item = parse("Holiday break October 12, 2026 to October 16, 2026")[0];
  assert.equal(item.endDate, "2026-10-16");
  const data = emptyData();
  const event = importOutlineItems(data, [item], destination(data), options.today).data.calendarEvents[0];
  assert.equal(event.allDay, true);
  assert.equal(event.endDate, "2026-10-17");
});

test("batch import creates domain entities/reminders and omits all source content", () => {
  const items = parse("Assignment 2 due October 20 at 11:59 PM\nMidterm October 21 2:30–3:50 PM");
  const data = emptyData();
  const project = { ...newEntity(), name: "School", color: "orange", sortKey: 0 };
  data.projects.push(project);
  const result = importOutlineItems(data, items, { ...destination(data), projectId: project.id, reminderMinutes: "30" }, options.today);
  assert.equal(result.added, 2);
  assert.equal(data.tasks.length, 0);
  assert.equal(result.data.tasks[0].projectId, project.id);
  assert.equal(result.data.tasks[0].priority, "low");
  assert.equal(result.data.tasks[0].dueTimeZone, "America/Edmonton");
  assert.equal(result.data.reminders[0].minutesBefore, 30);
  assert.equal(result.data.tasks[0].notes, "");
  assert.equal(result.data.calendarEvents[0].notes, "");
  assert.ok(!JSON.stringify(result.data).includes("source"));
});

test("re-importing skips existing and within-batch duplicates without adding reminders again", () => {
  const data = emptyData();
  const items = parse("Assignment 2 due October 20 11:59 PM\nMidterm October 21 2:30–3:50 PM");
  const first = importOutlineItems(data, [...items, { ...items[0], id: "copy" }], destination(data), options.today);
  assert.equal(first.added, 2);
  assert.equal(first.skipped, 1);
  assert.equal(isOutlineDuplicate(first.data, items[1], destination(data)), true);
  const again = importOutlineItems(first.data, items, destination(data), options.today);
  assert.equal(again.added, 0);
  assert.equal(again.skipped, 2);
  assert.equal(again.data, first.data);
});

test("invalid selected item makes batch atomic and old dates obey retention", () => {
  const data = emptyData();
  const items = parse("Assignment 2 due October 20\nMidterm October 21 at 2:30 PM");
  assert.throws(() => importOutlineItems(data, items, destination(data), options.today), /both start and end/);
  assert.equal(data.tasks.length, 0);
  const old = { ...items[0], date: "2026-08-01" };
  assert.match(outlineItemError(old, options.today), /31-day/);
  assert.throws(() => importOutlineItems(data, [old], destination(data), options.today), /31-day/);
});

test("read-only calendars, bad zones, archived projects and invalid reminders cannot receive imports", () => {
  const data = emptyData();
  const items = parse("Midterm October 21 2:30–3:50 PM");
  const dest = destination(data);
  assert.throws(() => importOutlineItems(data, items, { ...dest, readOnlyCalendarIds: [dest.calendarId] }, options.today), /editable/);
  assert.throws(() => importOutlineItems(data, items, { ...dest, timeZone: "bad" }, options.today), /time zone/);
  assert.throws(() => importOutlineItems(data, items, { ...dest, projectId: "missing" }, options.today), /active project/);
  assert.throws(() => importOutlineItems(data, items, { ...dest, reminderMinutes: "-1" }, options.today), /Reminder/);
});

test("DST boundary recurrence keeps local class times and changes UTC offset", () => {
  const data = emptyData();
  const item = parse("Lectures every Monday 2:30–3:50 PM", { termStart: "2026-10-26", termEnd: "2026-11-09" })[0];
  const imported = importOutlineItems(data, [item], { ...destination(data), timeZone: "America/New_York" }, options.today).data;
  const occurrences = calendarEventOccurrences(imported, "2026-10-26", "2026-11-10");
  assert.equal(occurrences[0].startInstant, "2026-10-26T18:30:00.000Z");
  assert.equal(occurrences[1].startInstant, "2026-11-02T19:30:00.000Z");
  // Edmonton rules differ across shipped ICU databases; the contract is local wall-clock time.
  const edmonton = importOutlineItems(data, [item], destination(data), options.today).data;
  const formatter = new Intl.DateTimeFormat("en", { timeZone: "America/Edmonton", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (const occurrence of calendarEventOccurrences(edmonton, "2026-10-26", "2026-11-10")) {
    assert.equal(formatter.format(new Date(occurrence.startInstant)), "14:30");
  }
});

test("weekly series re-imported later and reordered recurrence fields still skip duplicates", () => {
  const data = emptyData();
  const first = parse("Lectures every Monday and Wednesday 2:30–3:50 PM", { termStart: "2026-09-01", termEnd: "2026-12-10" })[0];
  const saved = importOutlineItems(data, [first], destination(data), options.today).data;
  const rule = saved.calendarEvents[0].recurrence;
  saved.calendarEvents[0].recurrence = { until: rule.until, weekdays: [3, 1], interval: 1, frequency: "weekly" };
  const later = parse("Lectures every Monday and Wednesday 2:30–3:50 PM", { termStart: "2026-09-01", termEnd: "2026-12-10", today: "2026-10-19" })[0];
  assert.equal(importOutlineItems(saved, [later], destination(saved), "2026-10-19").skipped, 1);
});

test("24-hour times and midnight are parsed without meridiem guesses", () => {
  assert.equal(outlineTimes("Due 00:00").time, "00:00");
  assert.deepEqual([outlineTimes("14:30–15:50").time, outlineTimes("14:30–15:50").endTime], ["14:30", "15:50"]);
});

test("source and candidate counts are bounded", () => {
  assert.throws(() => textOutlineBlocks("a".repeat(500_001)), /too large/);
  assert.throws(() => parse(Array.from({ length: 251 }, (_, i) => `Assignment ${i} due October 20`).join("\n")), /250/);
});

test("text file extraction is local and unsupported/empty/oversized files are rejected", async () => {
  const blocks = await readOutlineDocument(new File(["Assignment 2 due October 20"], "outline.txt"));
  assert.equal(blocks[0].text, "Assignment 2 due October 20");
  await assert.rejects(readOutlineDocument(new File(["hi"], "outline.exe")), /Supported files/);
  await assert.rejects(readOutlineDocument(new File([], "outline.txt")), /non-empty/);
  await assert.rejects(readOutlineDocument(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "outline.txt")), /10 MiB/);
  await assert.rejects(readOutlineDocument(new File(["not a pdf"], "outline.pdf")), /valid PDF/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readOutlineDocument(new File(["hello"], "outline.txt"), controller.signal), /cancelled/);
});
