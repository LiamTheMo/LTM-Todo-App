"use client";

import { useEffect, useRef, useState } from "react";
import { CustomSelect, DateField, TimeField } from "./CustomFields";
import { localDate, type Data } from "../lib/domain";
import { parseOutline, type OutlineBlock, type OutlineItem, type OutlineOptions } from "../lib/outline-parser";
import { readOutlineDocument, textOutlineBlocks } from "../lib/outline-document";
import { isOutlineDuplicate, outlineItemError, type OutlineDestination } from "../lib/outline-import";

type Props = { data: Data; readOnlyCalendarIds: string[]; onClose: () => void;
  onImport: (items: OutlineItem[], destination: OutlineDestination) => Promise<{ added: number; skipped: number }> };

export function OutlineImporter({ data, readOnlyCalendarIds, onClose, onImport }: Props) {
  const today = localDate(new Date());
  const [blocks, setBlocks] = useState<OutlineBlock[]>([]);
  const [pasted, setPasted] = useState("");
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [finished, setFinished] = useState(false);
  const [options, setOptions] = useState<OutlineOptions>({ year: new Date().getFullYear(), today });
  const calendars = data.calendars.filter(calendar => !calendar.deletedAt && !readOnlyCalendarIds.includes(calendar.id));
  const projects = data.projects.filter(project => !project.deletedAt && !project.archivedAt);
  const [destination, setDestination] = useState<OutlineDestination>({ calendarId: calendars[0]?.id || "", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", readOnlyCalendarIds });
  const controller = useRef<AbortController | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    closeButton.current?.focus();
    return () => { controller.current?.abort(); previous?.focus(); };
  }, []);
  useEffect(() => {
    if (!review) return;
    closeButton.current?.focus();
    const editor = dialog.current?.querySelector<HTMLElement>(".outlineEditor");
    if (editor) editor.scrollTop = 0;
  }, [review]);
  const update = (id: string, patch: Partial<OutlineItem>) => setItems(value => value.map(item => item.id === id ? { ...item, ...patch } : item));
  const setting = (patch: Partial<OutlineOptions>) => setOptions(value => ({ ...value, ...patch }));
  const selected = items.filter(item => item.selected);
  const selectedTasks = selected.filter(item => item.kind === "task").length;
  const selectedEvents = selected.length - selectedTasks;
  const invalid = selected.some(item => Boolean(outlineItemError(item, today)));
  const readFile = async (file: File) => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true); setStatus("Reading your file on this device…"); setBlocks([]); setItems([]); setPasted(""); setFileName("");
    try {
      const value = await readOutlineDocument(file, active.signal);
      if (active.signal.aborted) return;
      setBlocks(value); setFileName(file.name);
      setStatus("File read. Choose semester settings, then find items.");
    } catch (cause) {
      if (!active.signal.aborted) setStatus(cause instanceof Error ? cause.message : "The document could not be read.");
    } finally { if (!active.signal.aborted) setBusy(false); }
  };
  const findItems = () => {
    try {
      const value = parseOutline(pasted.trim() ? textOutlineBlocks(pasted) : blocks, options);
      setItems(value); setReview(true);
      setStatus(value.length ? `${value.length} items found. Review dates, task or event types, and destinations before importing.` : "No dated tasks or events found. Try pasting the assignment or schedule section with its headings.");
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "The outline could not be parsed."); }
  };
  const importSelected = async () => {
    setBusy(true); setStatus("Saving selected items…");
    try {
      const result = await onImport(items, { ...destination, readOnlyCalendarIds });
      setBlocks([]); setPasted(""); setFileName(""); setItems([]); setReview(false); setFinished(true);
      setStatus(`Imported ${result.added} items; skipped ${result.skipped} duplicates. Temporary document data was discarded.`);
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "Items could not be saved. Your source file has not been uploaded."); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="outlineDialog" aria-labelledby="outline-title" onCancel={event => { event.preventDefault(); if (!busy || !review) onClose(); }}>
    <div className="editor outlineEditor"><div className="editorHead"><h2 id="outline-title">Import tasks and events</h2><button ref={closeButton} type="button" aria-label="Close importer" disabled={busy && review} onClick={onClose}>×</button></div>
      <p className="hint">Import up to 250 tasks and calendar events from a course outline or event schedule. Review and select the whole batch before saving. Files are read on this device; only selected items are saved and synced, and temporary document data is discarded when you finish or close this importer.</p>
      {!finished && !review && <>
        <label>Choose an outline or schedule (PDF, DOCX, or text; up to 10 MiB)<input type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" disabled={busy} onChange={event => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void readFile(file);
        }} /></label>{fileName && <p className="hint">Selected: {fileName}</p>}
        <label>Or paste a list of assignments and events<textarea rows={7} maxLength={500_000} value={pasted} disabled={busy} placeholder={'Assignment 2 — due October 20 at 11:59 PM\nMidterm — October 21, 2:30–3:50 PM'} onChange={event => { setPasted(event.target.value); setBlocks([]); setFileName(""); }} /></label>
        <div className="fieldPair"><label>Semester year<input type="number" min="2000" max="2099" value={options.year} onChange={event => setting({ year: Number(event.target.value) })} /></label><label>Numeric date order<CustomSelect value={options.dateOrder || ""} aria-label="Numeric date order" onChange={event => setting({ dateOrder: event.target.value as OutlineOptions["dateOrder"] || undefined })}><option value="">Flag ambiguous dates</option><option value="mdy">Month / Day</option><option value="dmy">Day / Month</option></CustomSelect></label></div>
        <div className="fieldPair"><label>Semester start (for weekly classes)<DateField value={options.termStart || ""} onChange={value => setting({ termStart: value })} /></label><label>Semester end<DateField value={options.termEnd || ""} onChange={value => setting({ termEnd: value })} /></label></div>
        <label>Document reference date (for “tomorrow” / “next Friday”)<DateField value={options.referenceDate || ""} onChange={value => setting({ referenceDate: value })} /></label>
        <p className="hint">Scanned PDFs need OCR. Missing times remain unspecified. Week numbers and semester holidays need your review.</p>
        <div className="editorActions"><button type="button" className="add" disabled={busy || !pasted.trim() && !blocks.length} onClick={findItems}>Preview items</button></div>
      </>}
      {!finished && review && <>
        <div className="fieldPair"><label>Task project<CustomSelect value={destination.projectId || ""} aria-label="Task project" onChange={event => setDestination(value => ({ ...value, projectId: event.target.value || undefined }))}><option value="">No project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</CustomSelect></label><label>Event calendar<CustomSelect value={destination.calendarId} aria-label="Event calendar" onChange={event => setDestination(value => ({ ...value, calendarId: event.target.value }))}>{calendars.length ? calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>) : <option value="">Create an editable calendar first</option>}</CustomSelect></label></div>
        <div className="fieldPair"><label>Time zone<input value={destination.timeZone} maxLength={100} onChange={event => setDestination(value => ({ ...value, timeZone: event.target.value }))} /></label><label>Task reminders (timed deadlines only)<CustomSelect value={destination.reminderMinutes || ""} aria-label="Import task reminders" onChange={event => setDestination(value => ({ ...value, reminderMinutes: event.target.value }))}><option value="">No reminder</option><option value="0">At deadline</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></CustomSelect></label></div>
        <div className="outlineSelection"><button type="button" onClick={() => setItems(value => value.map(item => ({ ...item, selected: !outlineItemError(item, today) })))}>Select valid items</button><button type="button" onClick={() => setItems(value => value.map(item => ({ ...item, selected: false })))}>Deselect all</button><span>{selectedTasks} tasks · {selectedEvents} events selected</span></div>
        {items.map(item => {
          const error = outlineItemError(item, today);
          const duplicate = isOutlineDuplicate(data, item, destination);
          return <fieldset className="outlineItem" key={item.id}><legend>{item.kind === "task" ? "Task" : "Event"}{item.page ? ` · Page ${item.page}` : ""}</legend>
            <label className="checkLabel"><input type="checkbox" checked={item.selected} onChange={event => update(item.id, { selected: event.target.checked })} />Import this item{duplicate ? " (duplicate will be skipped)" : ""}</label>
            <label>Title<input value={item.title} maxLength={240} onChange={event => update(item.id, { title: event.target.value })} /></label>
            <div className="fieldPair"><label>Type<CustomSelect value={item.kind} aria-label={`Type for ${item.title}`} onChange={event => update(item.id, { kind: event.target.value as OutlineItem["kind"], endDate: item.endDate || item.date })}><option value="task">Task / deadline</option><option value="event">Calendar event</option></CustomSelect></label><label>{item.kind === "task" ? "Due date" : "Start date"}<DateField value={item.date} onChange={value => update(item.id, { date: value, endDate: item.endDate === item.date || !item.endDate ? value : item.endDate })} /></label></div>
            <div className="fieldPair"><label>{item.kind === "task" ? "Due time (optional)" : "Start time (optional)"}<TimeField value={item.time} onChange={value => update(item.id, { time: value })} /></label>{item.kind === "event" && <label>End time (optional)<TimeField value={item.endTime} onChange={value => update(item.id, { endTime: value })} /></label>}</div>
            {item.kind === "event" && <label>Last event date (inclusive)<DateField value={item.endDate} onChange={value => update(item.id, { endDate: value })} /></label>}
            {item.kind === "event" && item.weekdays.length > 0 && <><div><label className="checkLabel"><input type="checkbox" checked={true} onChange={() => update(item.id, { weekdays: [], until: "" })} />Repeat weekly</label>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => <label className="checkLabel" key={day}><input type="checkbox" checked={item.weekdays.includes(index)} onChange={event => update(item.id, { weekdays: event.target.checked ? [...item.weekdays, index].sort() : item.weekdays.filter(value => value !== index) })} />{day}</label>)}</div><label>Repeat until<DateField value={item.until} onChange={value => update(item.id, { until: value })} /></label></>}
            {item.time && <button type="button" className="linkButton" onClick={() => update(item.id, { time: "", endTime: "" })}>Clear times</button>}
            {item.warnings.length > 0 && <p className="hint">{item.warnings.length} parsing notes — check the source below.</p>}
            <details><summary>Source text and parsing notes</summary><p className="outlineSource">{item.source}</p>{item.warnings.map(warning => <p className="hint" key={warning}>{warning}</p>)}</details>
            {error && <p className="outlineWarning" role="status">{error}</p>}
          </fieldset>;
        })}
        <div className="editorActions"><button type="button" disabled={busy} onClick={() => { setReview(false); setItems([]); }}>Back to document</button><button type="button" className="add" disabled={busy || !selected.length || invalid} onClick={() => { void importSelected(); }}>Import {selected.length} items</button></div>
      </>}
      <p className="outlineStatus" role="status" aria-live="polite">{status}</p>
      {finished && <div className="editorActions"><button className="add" type="button" onClick={onClose}>Done</button></div>}
    </div>
  </dialog>;
}
