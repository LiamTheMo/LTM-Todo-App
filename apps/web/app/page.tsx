"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react";
import { addDays, completeTask, dashboardDays, deleteSection, emptyData, filterTasks, historyStart, localDate, newEntity, overdueTasks, parseLocalDate, pruneExpiredHistory, reorderProject, reorderSection, reorderTask, saveTask, undoCompletion, type Data, type DateScope, type Priority, type Task } from "../lib/domain";
import { readData, writeData } from "../lib/storage";

type View = "Dashboard" | "Inbox" | "Tasks" | "Projects" | "Settings";
const views: View[] = ["Dashboard", "Inbox", "Tasks", "Projects", "Settings"];
const icon: Record<View, string> = { Dashboard: "◫", Inbox: "▣", Tasks: "☑", Projects: "▦", Settings: "⚙" };
const priorities: Priority[] = ["none", "low", "medium", "high"];
const dashboardStep = 28;
const dashboardWindow = dashboardStep * 3;
const dateLabel = (day: string) => parseLocalDate(day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const timeLabel = (instant: string) => new Date(instant).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function Home() {
  const [data, setData] = useState<Data>(emptyData);
  const current = useRef<Data>(emptyData());
  const writes = useRef(Promise.resolve());
  const writeFailed = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("Dashboard");
  const [editing, setEditing] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [quickTitle, setQuickTitle] = useState("");
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [tagFilter, setTagFilter] = useState("");
  const [taskProjectFilter, setTaskProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [dateFilter, setDateFilter] = useState<DateScope | "all">("all");
  const [today, setToday] = useState(() => localDate(new Date()));
  const [dayStart, setDayStart] = useState(() => historyStart(localDate(new Date())));
  const earliestDay = historyStart(today);
  const visibleDayStart = dayStart < earliestDay ? earliestDay : dayStart;
  const todayRef = useRef<HTMLElement>(null);
  const dayScrollRef = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<{ day: string; top: number } | null>(null);
  const windowShiftLock = useRef(false);
  const initialScrollPending = useRef(true);
  useEffect(() => { readData().then(value => { current.current = value; setData(value); setReady(true); })
    .catch(() => { setError("Local storage could not be opened. Changes are disabled."); setReady(true); }); }, []);
  useEffect(() => {
    const refreshToday = () => {
      const day = localDate(new Date());
      setToday(previous => previous === day ? previous : day);
    };
    const timer = window.setInterval(refreshToday, 60_000);
    document.addEventListener("visibilitychange", refreshToday);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refreshToday); };
  }, []);
  useLayoutEffect(() => {
    const anchor = pendingAnchor.current;
    const scroller = dayScrollRef.current;
    if (anchor) {
      pendingAnchor.current = null;
      const element = scroller?.querySelector<HTMLElement>(`[data-day="${anchor.day}"]`);
      if (element && scroller) scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.top;
    }
    if (windowShiftLock.current) {
      requestAnimationFrame(() => { windowShiftLock.current = false; });
    }
  }, [visibleDayStart]);
  useLayoutEffect(() => {
    const scroller = dayScrollRef.current;
    const element = todayRef.current;
    if (!ready || view !== "Dashboard" || !initialScrollPending.current || !scroller || !element) return;
    initialScrollPending.current = false;
    scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  }, [ready, view, visibleDayStart]);
  const mutate = useCallback((change: (value: Data) => Data) => {
    if (error || writeFailed.current) return;
    const previous = current.current;
    const changed = pruneExpiredHistory(change(previous), today);
    if (changed === previous) return;
    const next = { ...changed, generation: previous.generation + 1 };
    current.current = next; setData(next);
    writes.current = writes.current.then(() => {
      if (!writeFailed.current) return writeData(next, previous.generation);
    }).catch((cause) => {
      writeFailed.current = true;
      setError(cause instanceof Error && cause.message.includes("another tab") ? cause.message :
        "Changes could not be saved. Download an unsaved backup from Settings before reloading this tab.");
    });
  }, [error, today]);
  useEffect(() => {
    if (ready) mutate(value => pruneExpiredHistory(value, today));
  }, [ready, today, mutate]);
  const addTask = (title: string, project?: string, dueDate?: string) => {
    if (!title.trim()) return;
    mutate(value => ({ ...value, tasks: [...value.tasks, { ...newEntity(), title: title.trim(), notes: "", priority: "none", projectId: project || undefined, tagIds: [], sortKey: Date.now(), dueDate }] }));
    setQuickTitle("");
  };
  const toggle = (task: Task) => mutate(value => {
    if (!task.completedAt) return completeTask(value, task.id);
    const completion = value.completions.filter(item => item.taskId === task.id).at(-1);
    return completion ? undoCompletion(value, completion.id) : { ...value, tasks: value.tasks.map(item => item.id === task.id ? {
      ...item, completedAt: undefined, updatedAt: new Date().toISOString(), revision: item.revision + 1
    } : item) };
  });
  const projects = data.projects.filter(p => !p.deletedAt && !p.archivedAt).sort((a, b) => a.sortKey - b.sortKey || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const tags = data.tags.filter(t => !t.deletedAt);
  const taskRow = (task: Task, caption?: string, completionId?: string, key = task.id) => {
    const isComplete = Boolean(completionId || task.completedAt);
    const latestCompletion = completionId && data.completions.filter(item => item.taskId === task.id).at(-1)?.id === completionId;
    return <div className={`taskRow ${isComplete ? "completed" : ""} ${task.parentTaskId ? "subtask" : ""}`} key={key}>
      <button className="complete" disabled={completionId ? !latestCompletion : data.tasks.some(child => child.parentTaskId === task.id && !child.completedAt && !child.deletedAt)} onClick={() => completionId ? latestCompletion && mutate(value => undoCompletion(value, completionId)) : toggle(task)} aria-label={isComplete ? `Reopen ${task.title}` : `Complete ${task.title}`}>{isComplete ? "✓" : "○"}</button>
      <button className="taskText" onClick={() => setEditing(task.id)}><span>{task.title}</span><small>{completionId ? `Completed ${caption ?? ""}` : data.tasks.some(child => child.parentTaskId === task.id && !child.completedAt && !child.deletedAt) ? "Finish subtasks first" : caption ?? [task.dueDate && `Due ${dateLabel(task.dueDate)}`, projects.find(p => p.id === task.projectId)?.name, task.priority !== "none" && `${task.priority} priority`].filter(Boolean).join(" · ")}</small></button>
      <button className="more" onClick={() => setEditing(task.id)} aria-label={`Edit ${task.title}`}>···</button>
    </div>;
  };
  const overdue = overdueTasks(data, today);
  const visible = filterTasks(data, { query, projectId: taskProjectFilter === "all" ? undefined : taskProjectFilter === "inbox" ? null : taskProjectFilter,
    tagId: tagFilter || undefined, priority: priorityFilter === "all" ? undefined : priorityFilter,
    completed: statusFilter === "all" ? undefined : statusFilter === "completed", dateScope: dateFilter === "all" ? undefined : dateFilter, today });
  const activeFilters = [query && `search “${query}”`, statusFilter !== "all" && statusFilter, taskProjectFilter !== "all" &&
    (taskProjectFilter === "inbox" ? "Inbox" : projects.find(p => p.id === taskProjectFilter)?.name),
    priorityFilter !== "all" && `${priorityFilter} priority`, tagFilter && `#${tags.find(t => t.id === tagFilter)?.name ?? "tag"}`,
    dateFilter !== "all" && dateFilter].filter(Boolean).join(" · ");
  const shiftDays = (direction: -1 | 1) => {
    const nextStart = addDays(visibleDayStart, direction * dashboardStep);
    const boundedStart = direction < 0 && nextStart < earliestDay ? earliestDay : nextStart;
    if (boundedStart === visibleDayStart) return;
    const scroller = dayScrollRef.current;
    if (scroller) {
      const bounds = scroller.getBoundingClientRect();
      const days = [...scroller.querySelectorAll<HTMLElement>("[data-day]")];
      const visibleDays = days.filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
      const anchor = direction < 0 ? visibleDays[0] : visibleDays.at(-1);
      if (anchor?.dataset.day) pendingAnchor.current = { day: anchor.dataset.day, top: anchor.getBoundingClientRect().top - bounds.top };
    }
    windowShiftLock.current = true;
    setDayStart(boundedStart);
  };
  const handleDayScroll = (event: UIEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget;
    if (windowShiftLock.current) return;
    if (scroller.scrollTop < 180) shiftDays(-1);
    else if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 180) shiftDays(1);
  };
  const goToday = () => {
    const today = localDate(new Date());
    const start = earliestDay;
    const scroller = dayScrollRef.current;
    const element = todayRef.current;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (visibleDayStart !== start) {
      pendingAnchor.current = { day: today, top: 0 };
      windowShiftLock.current = true;
      setDayStart(start);
    } else if (scroller && element) {
      scroller.scrollTo({ top: scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top, behavior });
    }
  };

  const dashboard = dashboardDays(data, visibleDayStart, dashboardWindow, today);
  return <main className="shell">
    <aside className="sidebar"><h1><span className="brandMark">✓</span> LTM Todo</h1><nav aria-label="Main navigation">{views.map(item => <button key={item} className={view === item ? "active" : ""} onClick={() => {
      setProjectId("");
      if (item === "Dashboard" && view !== "Dashboard") {
        initialScrollPending.current = true;
        setDayStart(historyStart(today));
      } else if (item === "Dashboard") goToday();
      setView(item);
    }}><span aria-hidden>{icon[item]}</span> {item}</button>)}</nav><div className="sidebarFoot">A calmer way through the day.</div></aside>
    <section className={`dashboard ${view === "Dashboard" ? "dashboardHome" : ""}`}>{error && <div className="error" role="alert">{error}</div>}
      {!ready ? <p>Opening your local tasks…</p> : <>
        <header className="pageHeader"><div><span className="eyebrow">YOUR SPACE</span><h2>{projectId && view === "Projects" ? projects.find(p => p.id === projectId)?.name : view}</h2><p>{view === "Dashboard" ? "A little clarity, one day at a time." : view === "Inbox" ? "Capture now. Organize when you're ready." : ""}</p></div><button className="add" onClick={() => setEditing("new")}>+ Add task</button></header>
        {view === "Dashboard" && <><div className="streamControls"><button onClick={goToday}>Return to Today</button></div>
          <section className="stream overduePanel" aria-label="Overdue tasks"><div className="group overdue"><h4>OVERDUE</h4>{overdue.length ? overdue.map(task => taskRow(task, `Due ${dateLabel(task.dueDate!)}`)) : <p className="overdueEmpty">Nothing overdue</p>}</div></section>
          <div className="stream dayScroller" ref={dayScrollRef} onScroll={handleDayScroll} role="region" aria-label="Days">
            <button className="loadMore" onClick={() => shiftDays(-1)} disabled={visibleDayStart <= earliestDay}>Earlier days ↑</button>
            {dashboard.map(day => {
            const past = day.date < today;
            const empty = !day.scheduled.length && !day.due.length && !day.completed.length;
            const label = day.date === today ? "TODAY" : day.date === addDays(today, 1) ? "TOMORROW" : dateLabel(day.date);
            return <article className={`day ${past ? "dayPast" : ""} ${empty ? "emptyDaySection" : ""}`} data-day={day.date} key={day.date} ref={day.date === today ? todayRef : undefined}>
            <div className="dayHeader"><h3 aria-label={`${label} ${day.date}`}>{label}</h3><time dateTime={day.date}>{day.date}</time></div>
            {!!day.scheduled.length && <div className="group"><h4>SCHEDULED</h4>{day.scheduled.map(({ block, task, completionId }) => taskRow(task, `${timeLabel(block.startInstant)} – ${timeLabel(block.endInstant)} · Work block${task.dueDate === day.date ? " · Also due today" : ""}`, completionId, `block:${block.id}`))}</div>}
            {!!day.due.length && <div className="group"><h4>DUE</h4>{day.due.map(task => taskRow(task, task.dueTime ? `Due at ${task.dueTime}` : "Due today"))}</div>}
            {!!day.completed.length && <div className="group"><h4>COMPLETED</h4>{day.completed.map(item => taskRow(item.task, new Date(item.completedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), item.completionId || undefined, `completion:${item.completionId || item.task.id}:${item.completedAt}`))}</div>}
            {empty ? <div className={`emptyDay ${past ? "pastEmpty" : ""}`}><span>{past ? "No completed items" : "Nothing planned"}</span><button onClick={() => setEditing(`new:${day.date}`)}>+ Add</button></div> :
              <button className="dayAdd" onClick={() => setEditing(`new:${day.date}`)}>+ Add task for this day</button>}
          </article>})}
            <button className="loadMore" onClick={() => shiftDays(1)}>Later days ↓</button>
          </div>
        </>}
        {(view === "Inbox" || view === "Tasks") && <>
          <form className="quickAdd" onSubmit={e => { e.preventDefault(); addTask(quickTitle); }}><span aria-hidden>＋</span><input aria-label="Quick add task" placeholder="Add a task…" value={quickTitle} onChange={e => setQuickTitle(e.target.value)} /><button disabled={!quickTitle.trim()}>Add</button></form>
          {view === "Tasks" && <><div className="filters"><input aria-label="Search tasks" placeholder="Search titles and notes…" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="Filter status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="open">Open</option><option value="completed">Completed</option><option value="all">All statuses</option></select><select aria-label="Filter project" value={taskProjectFilter} onChange={e => setTaskProjectFilter(e.target.value)}><option value="all">All projects</option><option value="inbox">Inbox</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select aria-label="Filter priority" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as Priority | "all")}><option value="all">All priorities</option>{priorities.map(p => <option key={p} value={p}>{p}</option>)}</select><select aria-label="Filter tag" value={tagFilter} onChange={e => setTagFilter(e.target.value)}><option value="">All tags</option>{tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><select aria-label="Filter due date" value={dateFilter} onChange={e => setDateFilter(e.target.value as DateScope | "all")}><option value="all">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="upcoming">Upcoming</option><option value="undated">No due date</option></select></div><p className="filterSummary" aria-live="polite">{visible.length} results · {activeFilters || "No filters"}</p></>}
          <div className="listPanel">{(view === "Inbox" ? filterTasks(data, { completed: false }).filter(t => !t.projectId) : visible).map(t => taskRow(t))}{!(view === "Inbox" ? data.tasks.some(t => !t.deletedAt && !t.completedAt && !t.projectId) : visible.length) && <div className="empty">All clear here. Add a task whenever you&apos;re ready.</div>}</div>
        </>}
        {view === "Projects" && <><form className="quickAdd" onSubmit={e => { e.preventDefault(); const input = e.currentTarget.elements.namedItem("project") as HTMLInputElement; if (!input.value.trim()) return; mutate(value => ({ ...value, projects: [...value.projects, { ...newEntity(), name: input.value.trim(), color: "#c86b24", sortKey: Date.now() }] })); input.value = ""; }}><input name="project" aria-label="New project name" placeholder="New project name…" /><button>Create project</button></form>
          {!projectId ? <div className="projectGrid">{projects.map(p => <div className="projectCard" key={p.id}><button className="projectOpen" onClick={() => setProjectId(p.id)}><span className="projectDot" style={{ background: p.color }} /><strong>{p.name}</strong><small>{data.tasks.filter(t => t.projectId === p.id && !t.deletedAt && !t.completedAt).length} open tasks →</small></button><div className="orderControls"><button aria-label={`Move project ${p.name} up`} onClick={() => mutate(value => reorderProject(value, p.id, -1))}>↑</button><button aria-label={`Move project ${p.name} down`} onClick={() => mutate(value => reorderProject(value, p.id, 1))}>↓</button></div></div>)}</div> : <>
            <button className="linkButton" onClick={() => setProjectId("")}>← All projects</button>
            {[undefined, ...data.sections.filter(s => s.projectId === projectId && !s.deletedAt).sort((a, b) => a.sortKey - b.sortKey)].map(section => <div className="projectGroup" key={section?.id ?? "root"}>
              <div className="projectGroupHead"><h3>{section?.name ?? "Project tasks"}</h3>{section && <div className="orderControls"><button aria-label={`Move section ${section.name} up`} onClick={() => mutate(value => reorderSection(value, section.id, -1))}>↑</button><button aria-label={`Move section ${section.name} down`} onClick={() => mutate(value => reorderSection(value, section.id, 1))}>↓</button><button onClick={() => { if (confirm("Delete this section? Its tasks will move to the project root.")) mutate(value => deleteSection(value, section.id)); }}>Delete section</button></div>}</div>
              <div className="listPanel">{filterTasks(data, { projectId, completed: false }).filter(t => t.sectionId === section?.id).map(t => <div className="orderedTask" key={t.id}>{taskRow(t)}<div><button aria-label={`Move ${t.title} up`} onClick={() => mutate(value => reorderTask(value, t.id, -1))}>↑</button><button aria-label={`Move ${t.title} down`} onClick={() => mutate(value => reorderTask(value, t.id, 1))}>↓</button></div></div>)}</div>
            </div>)}
            <form className="quickAdd" onSubmit={e => { e.preventDefault(); const input = e.currentTarget.elements.namedItem("section") as HTMLInputElement; if (!input.value.trim()) return; mutate(value => ({ ...value, sections: [...value.sections, { ...newEntity(), projectId, name: input.value.trim(), sortKey: Date.now() }] })); input.value = ""; }}><input name="section" aria-label="New section" placeholder="New section…" /><button>Add section</button></form>
            <button className="linkButton" onClick={() => { if (!confirm("Archive this project? Its tasks will leave active views until restored in Settings.")) return; mutate(value => { const stamp = new Date().toISOString(); return { ...value, projects: value.projects.map(p => p.id === projectId ? { ...p, archivedAt: stamp, updatedAt: stamp, revision: p.revision + 1 } : p) }; }); setProjectId(""); }}>Archive project</button>
          </>}
        </>}
        {view === "Settings" && <div className="settingsPanel"><h3>Local and private</h3><p>Your data is stored in this browser on this device. Cross-device sync arrives in a later phase.</p><button onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `ltm-todo-${today}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download backup JSON</button>
          <h3>Tags</h3><form className="quickAdd" onSubmit={e => { e.preventDefault(); const input = e.currentTarget.elements.namedItem("tag") as HTMLInputElement; if (!input.value.trim()) return; mutate(value => ({ ...value, tags: [...value.tags, { ...newEntity(), name: input.value.trim(), color: "#c86b24" }] })); input.value = ""; }}><input name="tag" aria-label="New tag name" placeholder="New tag name…" /><button>Add tag</button></form>{tags.map(t => <div className="tagLine" key={t.id}><span>#{t.name}</span><div><button onClick={() => { const name = prompt("Rename tag", t.name)?.trim(); if (name) mutate(value => ({ ...value, tags: value.tags.map(item => item.id === t.id ? { ...item, name, revision: item.revision + 1, updatedAt: new Date().toISOString() } : item) })); }}>Rename</button><button onClick={() => { if (confirm(`Delete tag ${t.name}?`)) mutate(value => ({ ...value, tags: value.tags.map(item => item.id === t.id ? { ...item, deletedAt: new Date().toISOString(), revision: item.revision + 1 } : item), tasks: value.tasks.map(item => item.tagIds.includes(t.id) ? { ...item, tagIds: item.tagIds.filter(id => id !== t.id), revision: item.revision + 1 } : item) })); }}>Delete</button></div></div>)}
          <h3>Archived projects</h3>{data.projects.filter(p => p.archivedAt && !p.deletedAt).map(p => <div className="tagLine" key={p.id}><span>{p.name}</span><button onClick={() => mutate(value => { const stamp = new Date().toISOString(); return { ...value, projects: value.projects.map(item => item.id === p.id ? { ...item, archivedAt: undefined, updatedAt: stamp, revision: item.revision + 1 } : item) }; })}>Restore</button></div>)}
        </div>}
      </>}
    </section>
    {editing && <TaskEditor key={editing} task={data.tasks.find(t => t.id === editing)} initialDate={editing.startsWith("new:") ? editing.slice(4) : undefined} initialProject={view === "Projects" ? projectId : undefined} data={data} earliestDate={historyStart(today)} onClose={() => setEditing(null)} onSave={(task, reminderMinutes) => {
      mutate(value => saveTask(value, task, reminderMinutes)); setEditing(null);
    }} onDelete={id => { mutate(value => { const stamp = new Date().toISOString(); return { ...value,
      tasks: value.tasks.map(t => t.id === id ? { ...t, deletedAt: stamp, revision: t.revision + 1 } : t),
      blocks: value.blocks.map(b => b.taskId === id && !b.deletedAt ? { ...b, deletedAt: stamp, revision: b.revision + 1 } : b),
      reminders: value.reminders.map(r => r.taskId === id && !r.deletedAt ? { ...r, deletedAt: stamp, revision: r.revision + 1 } : r)
    }; }); setEditing(null); }} />}
  </main>;
}

function TaskEditor({ task, initialDate, initialProject, data, earliestDate, onClose, onSave, onDelete }: {
  task?: Task; initialDate?: string; initialProject?: string; data: Data; earliestDate: string; onClose: () => void;
  onSave: (task: Task, reminder: string) => void; onDelete: (id: string) => void;
}) {
  const reminder = data.reminders.find(r => r.taskId === task?.id && !r.deletedAt);
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? initialDate ?? "");
  const [dueTime, setDueTime] = useState(task?.dueTime ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "none");
  const [projectId, setProjectId] = useState(task?.projectId ?? initialProject ?? "");
  const [sectionId, setSectionId] = useState(task?.sectionId ?? "");
  const [parentTaskId, setParentTaskId] = useState(task?.parentTaskId ?? "");
  const [tagIds, setTagIds] = useState(task?.tagIds ?? []);
  const [reminderMinutes, setReminderMinutes] = useState(reminder ? String(reminder.minutesBefore) : "");
  const [frequency, setFrequency] = useState(task?.recurrence?.frequency ?? "");
  const [interval, setInterval] = useState(task?.recurrence?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(task?.recurrence?.weekdays ?? []);
  const [repeatUntil, setRepeatUntil] = useState(task?.recurrence?.until ?? "");
  const [repeatCount, setRepeatCount] = useState(task?.recurrence?.count ? String(task.recurrence.count) : "");
  const expiredDueDate = Boolean(dueDate && dueDate < earliestDate);
  return <div className="modalBackdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><form className="editor" onSubmit={e => {
    e.preventDefault(); if (!title.trim() || expiredDueDate || (frequency && (!dueDate || (repeatUntil && repeatUntil < dueDate) || (repeatCount !== "" && Number(repeatCount) < 1)))) return;
    const stamp = new Date().toISOString();
    onSave({ ...(task ?? newEntity()), title: title.trim(), notes, priority, projectId: projectId || undefined, sectionId: projectId && sectionId ? sectionId : undefined,
      parentTaskId: parentTaskId || undefined, tagIds, sortKey: task?.sortKey ?? Date.now(), dueDate: dueDate || undefined,
      dueTime: dueDate && dueTime ? dueTime : undefined, dueTimeZone: dueDate && dueTime ? zone() : undefined, updatedAt: stamp, revision: task ? task.revision + 1 : 1,
      recurrence: frequency && dueDate ? { frequency: frequency as "daily" | "weekly" | "monthly" | "yearly", interval: Math.max(1, interval),
        anchorDate: task?.dueDate === dueDate ? task?.recurrence?.anchorDate ?? dueDate : dueDate, occurrences: task?.recurrence?.occurrences ?? 0,
        weekdays: frequency === "weekly" ? weekdays : undefined, until: repeatUntil || undefined,
        count: repeatCount ? Number(repeatCount) : undefined } : undefined
    }, reminderMinutes);
  }}>
    <div className="editorHead"><h2>{task ? "Edit task" : "New task"}</h2><button type="button" onClick={onClose} aria-label="Close editor">×</button></div>
    <label>Title<input autoFocus required value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?" /></label>
    <label>Notes<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    <div className="fieldPair"><label>Due date<input type="date" min={earliestDate} value={dueDate} onChange={e => setDueDate(e.target.value)} /></label><label>Due time<input type="time" disabled={!dueDate} value={dueTime} onChange={e => setDueTime(e.target.value)} /></label></div>
    {expiredDueDate && <p className="hint">Choose a date within the seven-day history window.</p>}
    <div className="fieldPair"><label>Priority<select value={priority} onChange={e => setPriority(e.target.value as Priority)}>{priorities.map(p => <option key={p} value={p}>{p}</option>)}</select></label><label>Project<select value={projectId} onChange={e => { setProjectId(e.target.value); setSectionId(""); setParentTaskId(""); }}><option value="">Inbox</option>{data.projects.filter(p => !p.deletedAt && !p.archivedAt).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
    {projectId && <label>Section<select value={sectionId} onChange={e => setSectionId(e.target.value)}><option value="">Project root</option>{data.sections.filter(s => s.projectId === projectId && !s.deletedAt).map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>}
    <label>Subtask of<select value={parentTaskId} onChange={e => setParentTaskId(e.target.value)}><option value="">No parent</option>{data.tasks.filter(t => !t.deletedAt && !t.parentTaskId && t.id !== task?.id && (t.projectId ?? "") === projectId).map(t => <option value={t.id} key={t.id}>{t.title}</option>)}</select></label>
    {!!data.tags.length && <fieldset><legend>Tags</legend>{data.tags.filter(t => !t.deletedAt).map(t => <label className="checkLabel" key={t.id}><input type="checkbox" checked={tagIds.includes(t.id)} onChange={e => setTagIds(e.target.checked ? [...tagIds, t.id] : tagIds.filter(id => id !== t.id))} /> {t.name}</label>)}</fieldset>}
    <div className="fieldPair"><label>Repeat<select value={frequency} onChange={e => setFrequency(e.target.value)}><option value="">Never</option>{["daily", "weekly", "monthly", "yearly"].map(f => <option key={f} value={f}>{f}</option>)}</select></label><label>Every<input type="number" min="1" max="365" disabled={!frequency} value={interval} onChange={e => setInterval(Number(e.target.value))} /></label></div>
    {frequency === "weekly" && <fieldset><legend>Repeat on</legend>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name, day) => <label className="checkLabel" key={day}><input type="checkbox" checked={weekdays.includes(day)} onChange={e => setWeekdays(e.target.checked ? [...weekdays, day] : weekdays.filter(value => value !== day))} /> {name}</label>)}<p className="hint">If none are selected, repeat on the original weekday.</p></fieldset>}
    {frequency && <div className="fieldPair"><label>Repeat until<input type="date" min={dueDate} value={repeatUntil} onChange={e => setRepeatUntil(e.target.value)} /></label><label>End after occurrences<input type="number" min="1" value={repeatCount} onChange={e => setRepeatCount(e.target.value)} placeholder="No limit" /></label></div>}
    <label>Reminder before deadline<select value={reminderMinutes} onChange={e => setReminderMinutes(e.target.value)}><option value="">None</option><option value="0">At due time</option><option value="15">15 minutes</option><option value="60">1 hour</option><option value="1440">1 day</option></select></label>
    {reminderMinutes !== "" && !dueTime && <p className="hint">Choose a due date and time for a timed reminder.</p>}
    <div className="editorActions">{task && <button type="button" className="danger" onClick={() => { if (confirm("Delete this task?")) onDelete(task.id); }}>Delete task</button>}<button type="button" onClick={onClose}>Cancel</button><button className="add" disabled={!title.trim() || expiredDueDate}>Save task</button></div>
  </form></div>;
}
