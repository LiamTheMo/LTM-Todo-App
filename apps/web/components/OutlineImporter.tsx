"use client";

import { useEffect, useRef, useState } from "react";
import { CustomSelect, DateField, TimeField } from "./CustomFields";
import { localDate, type Data } from "../lib/domain";
import { MAX_PASTED_TEXT_CHARACTERS, parseOutline, type OutlineBlock, type OutlineItem, type OutlineOptions } from "../lib/outline-parser";
import { readOutlineDocument, textOutlineBlocks } from "../lib/outline-document";
import { isOutlineDuplicate, outlineItemError, type OutlineDestination } from "../lib/outline-import";
import { MAX_BULK_IMPORT_BYTES, MAX_BULK_IMPORT_FILES, MAX_BULK_IMPORT_ITEMS, parseBulkDelimitedFile } from "../lib/bulk-import";

const REVIEW_PAGE_SIZE = 50;

type Props = { data: Data; readOnlyCalendarIds: string[]; onClose: () => void;
  onImport: (items: OutlineItem[], destination: OutlineDestination) => Promise<{ added: number; skipped: number }> };

export function OutlineImporter({ data, readOnlyCalendarIds, onClose, onImport }: Props) {
  const today = localDate(new Date());
  const [blocks, setBlocks] = useState<OutlineBlock[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [pasted, setPasted] = useState("");
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [finished, setFinished] = useState(false);
  const [options, setOptions] = useState<OutlineOptions>({ today });
  const [reviewPage, setReviewPage] = useState(0);
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
  const readFiles = async (selectedFiles: File[]) => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true); setStatus("Reading files on this device…"); setBlocks([]); setFiles([]); setItems([]); setPasted(""); setFileName("");
    try {
      if (!selectedFiles.length || selectedFiles.length > MAX_BULK_IMPORT_FILES) throw new Error(`Choose between 1 and ${MAX_BULK_IMPORT_FILES} files per batch.`);
      if (selectedFiles.reduce((total, file) => total + file.size, 0) > MAX_BULK_IMPORT_BYTES) throw new Error("The combined file size exceeds 50 MiB.");
      const extracted: OutlineBlock[] = [];
      for (const file of selectedFiles) {
        if (active.signal.aborted) return;
        const extension = file.name.split(".").pop()?.toLowerCase();
        if (extension === "csv" || extension === "tsv") {
          if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} exceeds the 5 MiB table-file limit.`);
        } else extracted.push(...await readOutlineDocument(file, active.signal));
      }
      if (active.signal.aborted) return;
      setBlocks(extracted); setFiles(selectedFiles); setFileName(selectedFiles.map(file => file.name).join(", "));
      setStatus(`${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} ready. Build and review the full batch.`);
    } catch (cause) {
      if (!active.signal.aborted) setStatus(cause instanceof Error ? cause.message : "The selected files could not be read.");
    } finally { if (!active.signal.aborted) setBusy(false); }
  };
  const findItems = async () => {
    setBusy(true);
    try {
      const detected = pasted.trim() ? parseOutline(textOutlineBlocks(pasted), options) : parseOutline(blocks, options);
      const structured: OutlineItem[] = [];
      for (const file of files) {
        const extension = file.name.split(".").pop()?.toLowerCase();
        if (extension === "csv" || extension === "tsv") structured.push(...await parseBulkDelimitedFile(file, options));
      }
      const value = [...detected, ...structured].map((item, index) => ({ ...item, id: `import-${index}` }));
      if (value.length > MAX_BULK_IMPORT_ITEMS) throw new Error(`This batch contains more than ${MAX_BULK_IMPORT_ITEMS} items. Split it into smaller imports.`);
      setItems(value); setReviewPage(0); setReview(true);
      setStatus(value.length ? `${value.length} items found across ${files.length || 1} source${files.length === 1 ? "s" : ""}. Review and select the batch before saving.` : "No importable items found. Try a CSV with title and date columns, or paste a task/event list.");
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "The selected sources could not be processed."); }
    finally { setBusy(false); }
  };
  const importSelected = async () => {
    setBusy(true); setStatus("Saving selected items…");
    try {
      const result = await onImport(items, { ...destination, readOnlyCalendarIds });
      setBlocks([]); setFiles([]); setPasted(""); setFileName(""); setItems([]); setReview(false); setFinished(true);
      setStatus(`Imported ${result.added} items; skipped ${result.skipped} duplicates. Temporary source data was discarded.`);
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "Items could not be saved. Your source file has not been uploaded."); }
    finally { setBusy(false); }
  };
  const downloadCsvTemplate = () => {
    const blob = new Blob(["type,title,date,start time,end time,end date,notes,priority\r\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "ltm-import-template.csv"; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const pageCount = Math.max(1, Math.ceil(items.length / REVIEW_PAGE_SIZE));
  const visibleItems = items.slice(reviewPage * REVIEW_PAGE_SIZE, (reviewPage + 1) * REVIEW_PAGE_SIZE);
  return <dialog ref={dialog} className="outlineDialog" aria-labelledby="outline-title" onCancel={event => { event.preventDefault(); if (!busy || !review) onClose(); }}>
    <div className="editor outlineEditor"><div className="editorHead"><h2 id="outline-title">Import tasks and events</h2><button ref={closeButton} type="button" aria-label="Close importer" disabled={busy && review} onClick={onClose}>×</button></div>
      <p className="hint">Build one batch of up to 1,000 tasks and calendar events from multiple documents or data files. CSV/TSV rows can use a title and date column, with optional type, time, end date/time, notes, and priority columns. Review and select the batch before saving. Files are processed on this device and temporary source data is discarded when you finish or close.</p>
      {!finished && !review && <>
        <label>Choose multiple files (PDF, DOCX, TXT, Markdown, CSV, TSV; up to 10 files / 50 MiB total, 10 MiB per document)<input type="file" multiple accept=".pdf,.docx,.txt,.md,.csv,.tsv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv,text/tab-separated-values" disabled={busy} onChange={event => {
          const selectedFiles = Array.from(event.currentTarget.files || []); event.currentTarget.value = ""; if (selectedFiles.length) void readFiles(selectedFiles);
        }} /></label>{fileName && <p className="hint">Selected: {fileName}</p>}
        <button type="button" className="linkButton" onClick={downloadCsvTemplate}>Download CSV template</button>
        <label>Or paste a task/event list<textarea rows={7} maxLength={MAX_PASTED_TEXT_CHARACTERS} value={pasted} disabled={busy} placeholder={'Task, due October 20 at 11:59 PM\nMeeting, October 21, 2:30–3:50 PM'} onChange={event => { setPasted(event.target.value); setBlocks([]); setFiles([]); setFileName(""); }} /></label>
        <div className="fieldPair"><label>Numeric date order<CustomSelect value={options.dateOrder || ""} aria-label="Numeric date order" onChange={event => setting({ dateOrder: event.target.value as OutlineOptions["dateOrder"] || undefined })}><option value="">Flag ambiguous dates</option><option value="mdy">Month / Day</option><option value="dmy">Day / Month</option></CustomSelect></label><label>Reference date (for “tomorrow” / “next Friday”)<DateField value={options.referenceDate || ""} onChange={value => setting({ referenceDate: value })} /></label></div>
        <p className="hint">CSV/TSV needs a header row such as <code>type,title,date,start time,end time,notes,priority</code>. Use YYYY-MM-DD for dates where possible. Scanned PDFs need OCR.</p>
        <div className="editorActions"><button type="button" className="add" disabled={busy || !pasted.trim() && !blocks.length && !files.length} onClick={() => { void findItems(); }}>Build import batch</button></div>
      </>}
      {!finished && review && <>
        <div className="fieldPair"><label>Task project<CustomSelect value={destination.projectId || ""} aria-label="Task project" onChange={event => setDestination(value => ({ ...value, projectId: event.target.value || undefined }))}><option value="">No project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</CustomSelect></label><label>Event calendar<CustomSelect value={destination.calendarId} aria-label="Event calendar" onChange={event => setDestination(value => ({ ...value, calendarId: event.target.value }))}>{calendars.length ? calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>) : <option value="">Create an editable calendar first</option>}</CustomSelect></label></div>
        <div className="fieldPair"><label>Time zone<input value={destination.timeZone} maxLength={100} onChange={event => setDestination(value => ({ ...value, timeZone: event.target.value }))} /></label><label>Task reminders (timed deadlines only)<CustomSelect value={destination.reminderMinutes || ""} aria-label="Import task reminders" onChange={event => setDestination(value => ({ ...value, reminderMinutes: event.target.value }))}><option value="">No reminder</option><option value="0">At deadline</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></CustomSelect></label></div>
        <div className="outlineSelection"><button type="button" onClick={() => setItems(value => value.map(item => ({ ...item, selected: !outlineItemError(item, today) })))}>Select valid items</button><button type="button" onClick={() => setItems(value => value.map(item => ({ ...item, selected: false })))}>Deselect all</button><span>{selectedTasks} tasks · {selectedEvents} events selected · {items.length} total</span></div>
        {items.length > REVIEW_PAGE_SIZE && <div className="outlineSelection" aria-label="Import item pages"><button type="button" disabled={reviewPage === 0} onClick={() => setReviewPage(page => Math.max(0, page - 1))}>Previous 50</button><span>Showing {reviewPage * REVIEW_PAGE_SIZE + 1}–{Math.min(items.length, (reviewPage + 1) * REVIEW_PAGE_SIZE)} of {items.length}</span><button type="button" disabled={reviewPage + 1 >= pageCount} onClick={() => setReviewPage(page => Math.min(pageCount - 1, page + 1))}>Next 50</button></div>}
        {visibleItems.map(item => {
          const error = outlineItemError(item, today);
          const duplicate = isOutlineDuplicate(data, item, destination);
          return <fieldset className="outlineItem" key={item.id}><legend>{item.kind === "task" ? "Task" : "Event"}{item.page ? ` · Page ${item.page}` : ""}</legend>
            <label className="checkLabel"><input type="checkbox" checked={item.selected} onChange={event => update(item.id, { selected: event.target.checked })} />Import this item{duplicate ? " (duplicate will be skipped)" : ""}</label>
            <label>Title<input value={item.title} maxLength={240} onChange={event => update(item.id, { title: event.target.value })} /></label>
            <div className="fieldPair"><label>Type<CustomSelect value={item.kind} aria-label={`Type for ${item.title}`} onChange={event => update(item.id, { kind: event.target.value as OutlineItem["kind"], endDate: item.endDate || item.date })}><option value="task">Task / deadline</option><option value="event">Calendar event</option></CustomSelect></label><label>{item.kind === "task" ? "Due date" : "Start date"}<DateField value={item.date} onChange={value => update(item.id, { date: value, endDate: item.endDate === item.date || !item.endDate ? value : item.endDate })} /></label></div>
            <div className="fieldPair"><label>{item.kind === "task" ? "Due time (optional)" : "Start time (optional)"}<TimeField value={item.time} onChange={value => update(item.id, { time: value })} /></label>{item.kind === "event" && <label>End time (optional)<TimeField value={item.endTime} onChange={value => update(item.id, { endTime: value })} /></label>}</div>
            {item.kind === "event" && <label>Last event date (inclusive)<DateField value={item.endDate} onChange={value => update(item.id, { endDate: value })} /></label>}
            {item.kind === "event" && item.weekdays.length > 0 && <><div><label className="checkLabel"><input type="checkbox" checked={true} onChange={() => update(item.id, { weekdays: [], until: "" })} />Repeat weekly</label>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => <label className="checkLabel" key={day}><input type="checkbox" checked={item.weekdays.includes(index)} onChange={event => update(item.id, { weekdays: event.target.checked ? [...item.weekdays, index].sort() : item.weekdays.filter(value => value !== index) })} />{day}</label>)}</div><label>Repeat until<DateField value={item.until} onChange={value => update(item.id, { until: value })} /></label></>}
            {item.kind === "task" && <div className="fieldPair"><label>Priority<CustomSelect value={item.priority || "low"} aria-label={`Priority for ${item.title}`} onChange={event => update(item.id, { priority: event.target.value as OutlineItem["priority"] })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></CustomSelect></label><label>Notes<textarea rows={2} maxLength={5000} value={item.notes || ""} onChange={event => update(item.id, { notes: event.target.value })} /></label></div>}
            {item.kind === "event" && <label>Notes<textarea rows={2} maxLength={5000} value={item.notes || ""} onChange={event => update(item.id, { notes: event.target.value })} /></label>}
            {item.time && <button type="button" className="linkButton" onClick={() => update(item.id, { time: "", endTime: "" })}>Clear times</button>}
            {item.warnings.length > 0 && <p className="hint">{item.warnings.length} parsing notes — check the source below.</p>}
            <details><summary>Source text and parsing notes</summary><p className="outlineSource">{item.source}</p>{item.warnings.map(warning => <p className="hint" key={warning}>{warning}</p>)}</details>
            {error && <p className="outlineWarning" role="status">{error}</p>}
          </fieldset>;
        })}
        <div className="editorActions"><button type="button" disabled={busy} onClick={() => { setReview(false); setItems([]); }}>Back to sources</button><button type="button" className="add" disabled={busy || !selected.length || invalid} onClick={() => { void importSelected(); }}>Import {selected.length} items</button></div>
      </>}
      <p className="outlineStatus" role="status" aria-live="polite">{status}</p>
      {finished && <div className="editorActions"><button className="add" type="button" onClick={onClose}>Done</button></div>}
    </div>
  </dialog>;
}
