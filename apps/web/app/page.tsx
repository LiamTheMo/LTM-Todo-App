Warning: truncated output (original token count: 18967)
Total output lines: 672

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react";
import { addDays, calendarGridDates, bulkCompleteTasks, bulkSetPriority, completeTask, createRoutine, dashboardDays, deleteSection, deleteScheduledBlock, emptyData, filterTasks, historyStart, instantiateTaskTemplate, localDate, newEntity, overdueTasks, parseLocalDate, scheduledReminderTriggers, pruneExpiredHistory, reorderProject, reorderSection, reorderTask, saveScheduledBlock, saveTask, saveTaskTemplate, setRoutineEnabled, undoCompletion, type CalendarEvent, type Data, type DateScope, type Priority, type ScheduledBlock, type Task, type TaskTemplate } from "../lib/domain";
import { calendarColors, calendarEventsForDay, calendarEventOccurrences, createCalendar, instantiateEventTemplate, saveCalendarEvent, saveEventTemplate, zonedDateTimeToInstant } from "../lib/calendar-domain";
import { readData, writeData } from "../lib/storage";
import { dueTimeCaption, overdueDueCaption } from "../lib/date-labels";
import { TabIcon, type NavigationSection } from "../components/TabIcon";
import { CalendarTimeline, type CalendarTimelineItem } from "../components/CalendarTimeline";

type View = NavigationSection;
const views: View[] = ["Dashboard", "Tasks", "Projects", "Calendar", "Settings"];
const priorities: Priority[] = ["none", "low", "medium", "high"];
const priorityLabel = (priority: Priority) => priority.charAt(0).toUpperCase() + priority.slice(1);
const calendarWeekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dashboardStep = 28;
const dashboardWindow = dashboardStep * 3;
const dateLabel = (day: string) => parseLocalDate(day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const timeLabel = (instant: string) => new Date(instant).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const pushTokenKey = "ltm-todo-push-device-token";
type PushConfig = { enabled: boolean; publicKey: string | null };

async function pushConfig(): Promise<PushConfig> {
  const response = await fetch("/api/notifications/config", { cache: "no-store" });
  if (!response.ok) throw new Error("Notification setup could not be checked.");
  return response.json() as Promise<PushConfig>;
}

function applicationServerKey(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

async function getPushSubscription(registration: ServiceWorkerRegistration, publicKey: string) {
  const expected = applicationServerKey(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  const existing = subscription?.options.applicationServerKey;
  const current = existing && new Uint8Array(existing);
  const matches = !existing || Boolean(current && current.length === expected.length && current.every((byte, index) => byte === expected[index]));
  if (subscription && !matches) { await subscription.unsubscribe(); subscription = null; }
  return subscription ?? registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: expected });
}

function newPushToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function registerPushDevice(config: PushConfig, promptForPermission: boolean) {
  if (!config.enabled || !config.publicKey) throw new Error("Push notifications are not configured on the server yet.");
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("This browser does not support push notifications.");
  }
  if (!window.isSecureContext) throw new Error("Push notifications need a secure website connection.");
  let permission = Notification.permission;
  if (permission === "default" && promptForPermission) permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied"
    ? "Notifications are blocked in browser settings. Allow them there, then try again."
    : "Allow notifications to enable reminders.");
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const subscription = await getPushSubscription(registration, config.publicKey);
  const token = localStorage.getItem(pushTokenKey) ?? newPushToken();
  const response = await fetch("/api/notifications/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, subscription: subscription.toJSON() })
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error ?? "This device could not be registered for push notifications.");
  }
  localStorage.setItem(pushTokenKey, token);
  return token;
}

async function removePushDevice(token: string) {
  try {
    await fetch("/api/notifications/register", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  } finally {
    const registration = await navigator.serviceWorker.getRegistration("/");
    await registration?.pushManager.getSubscription().then(subscription => subscription?.unsubscribe());
    localStorage.removeItem(pushTokenKey);
  }
}

export default function Home() {
  const [data, setData] = useState<Data>(emptyData);
  const current = useRef<Data>(emptyData());
  const writes = useRef(Promise.resolve());
  const writeFailed = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("Dashboard");
  const [calendarMonth, setCalendarMonth] = useState(() => localDate(new Date()).slice(0, 7));
  const [calendarSelectedDate, setCalendarSelectedDate] = useState(() => localDate(new Date()));
  const [calendarMode, setCalendarMode] = useState<"month" | "week" | "day" | "agenda">("month");
  const [calendarNow, setCalendarNow] = useState(() => new Date());
  const [eventEditing, setEventEditing] = useState<{ id?: string; date: string } | null>(null);
  const [scheduleEditing, setScheduleEditing] = useState<{ taskId: string; blockId?: string; date: string } | null>(null);
  const [scheduleUndo, setScheduleUndo] = useState<ScheduledBlock[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [quickTitle, setQuickTitle] = useState("");
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [tagFilter, setTagFilter] = useState("");
  const [taskProjectFilter, setTaskProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [dateFilter, setDateFilter] = useState<DateScope | "all">("all");
  const [savedViewId, setSavedViewId] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [kanbanMode, setKanbanMode] = useState(false);
  const [kanbanGrouping, setKanbanGrouping] = useState<"status" | "priority">("status");
  const [bulkPriority, setBulkPriority] = useState<Priority>("medium");
  const [routineTemplateId, setRoutineTemplateId] = useState("");
  const [routineStartDate, setRoutineStartDate] = useState(() => localDate(new Date()));
  const [routineFrequency, setRoutineFrequency] = useState<"daily" | "weekly" | "monthly" | "yearly">("weekly");
  const [routineInterval, setRoutineInterval] = useState(1);
  const [pushToken, setPushToken] = useState("");
  const [pushActive, setPushActive] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("default");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushStatus, setPushStatus] = useState("Checking push notification support…");
  const [pushSyncRevision, setPushSyncRevision] = useState(0);
  const pushSyncQueue = useRef(Promise.resolve());
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
  useEffect(() => {
    const timer = window.setInterval(() => setCalendarNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const retryPushSync = () => setPushSyncRevision(value => value + 1);
    window.addEventListener("online", retryPushSync);
    return () => window.removeEventListener("online", retryPushSync);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const supported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window && window.isSecureContext;
    void (async () => {
      try {
        await Promise.resolve();
        if (cancelled) return;
        setPushSupported(supported);
        if (!supported) { setPushPermission("unsupported"); setPushStatus("Push notifications are not supported in this browser context."); return; }
        setPushPermission(Notification.permission);
        const config = await pushConfig();
        if (cancelled) return;
        if (!config.enabled || !config.publicKey) { setPushStatus("Push notification service setup is not complete yet."); return; }
        const token = localStorage.getItem(pushTokenKey);
        if (!token || Notification.permission !== "granted") {
          if (token && Notification.permission === "denied") await removePushDevice(token);
          setPushStatus(Notification.permission === "denied" ? "Notifications are blocked in browser settings." : "Enable notifications on this device to receive reminders.");
          return;
        }
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const subscription = await getPushSubscription(registration, config.publicKey);
        const response = await fetch("/api/notifications/register", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, subscription: subscription.toJSON() })
        });
        if (!response.ok) throw new Error("This device could not reconnect to push notifications.");
        if (!cancelled) { setPushToken(token); setPushActive(true); setPushStatus("Push notifications are enabled on this device."); }
      } catch (cause) {
        if (!cancelled) setPushStatus(cause instanceof Error ? cause.message : "Push notification setup could not be checked.");
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!ready || error || !pushActive || !pushToken) return;
    let cancelled = false;
    const reminders = scheduledReminderTriggers(data).slice(0, 5_000).map(({ reminder, task, triggerAt }) => ({
      id: reminder.id, title: task.title, triggerAt: Math.floor(triggerAt)
    }));
    pushSyncQueue.current = pushSyncQueue.current.catch(() => undefined).then(async () => {
      if (cancelled) return;
      const response = await fetch("/api/notifications/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pushToken}` },
        body: JSON.stringify({ reminders })
      });
      if (!response.ok) throw new Error("Reminder schedules could not be synchronized. Check your connection and reopen Settings to retry.");
      if (!cancelled) {
        const total = scheduledReminderTriggers(data).length;
        setPushStatus(reminders.length < total
          ? `First ${reminders.length.toLocaleString()} of ${total.toLocaleString()} reminders synced; this device supports up to 5,000 scheduled reminders.`
          : `${reminders.length} reminder${reminders.length === 1 ? "" : "s"} synced to this device.`);
      }
    }).catch(cause => {
      if (!cancelled) setPushStatus(cause instanceof Error ? cause.message : "Reminder schedules could not be synchronized.");
    });
    return () => { cancelled = true; };
  }, [data, error, pushActive, pushToken, pushSyncRevision, ready]);
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
      <button className="taskText" draggable={!isComplete} onDragStart={e => { if (isComplete) return; e.dataTransfer.setData("application/x-ltm-task", task.id); e.dataTransfer.effectAllowed = "copy"; }} onClick={() => setEditing(task.id)}><span>{task.title}</span><small>{completionId ? `Completed ${caption ?? ""}` : data.tasks.some(child => child.parentTaskId === task.id && !child.completedAt && !child.deletedAt) ? "Finish subtasks first" : caption ?? [task.dueDate && `Due ${dateLabel(task.dueDate)}`, projects.find(p => p.id === task.projectId)?.name, task.priority !== "none" && `${priorityLabel(task.priority)} priority`].filter(Boolean).join(" · ")}</small></button>
      {!isComplete && <button className="scheduleAction" onClick={() => setScheduleEditing({ taskId: task.id, date: calendarSelectedDate })} aria-label={`Schedule work for ${task.title}`} title="Schedule work">◷</button>}
      <button className="more" onClick={() => setEditing(task.id)} aria-label={`Edit ${task.title}`}>···</button>
    </div>;
  };
  const overdue = overdueTasks(data, today);
  const visible = filterTasks(data, { query, projectId: taskProjectFilter === "all" ? undefined : taskProjectFilter === "inbox" ? null : taskProjectFilter,
    tagId: tagFilter || undefined, priority: priorityFilter === "all" ? undefined : priorityFilter,
    completed: statusFilter === "all" ? undefined : statusFilter === "completed", dateScope: dateFilter === "all" ? undefined : dateFilter, today });
  const activeFilters = [query && `search “${query}”`, statusFilter !== "all" && statusFilter, taskProjectFilter !== "all" &&
    (taskProjectFilter === "inbox" ? "Inbox" : projects.find(p => p.id === taskProjectFilter)?.name),
    priorityFilter !== "all" && `${priorityLabel(priorityFilter)} priority`, tagFilter && `#${tags.find(t => t.id === tagFilter)?.name ?? "tag"}`,
    dateFilter !== "all" && dateFilter].filter(Boolean).join(" · ");
  const kanbanGroups = kanbanGrouping === "status"
    ? [{ key: "open", label: "Open", tasks: visible.filter(task => !task.completedAt) }, { key: "completed", label: "Completed", tasks: visible.filter(task => Boolean(task.completedAt)) }]
    : priorities.map(priority => ({ key: priority, label: priorityLabel(priority), tasks: visible.filter(task => task.priority === priority) }));
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
  …8967 tokens truncated…= t.id ? { ...item, deletedAt: new Date().toISOString(), revision: item.revision + 1 } : item), tasks: value.tasks.map(item => item.tagIds.includes(t.id) ? { ...item, tagIds: item.tagIds.filter(id => id !== t.id), revision: item.revision + 1 } : item) })); }}>Delete</button></div></div>)}
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
    {eventEditing && <CalendarEventEditor key={`${eventEditing.id ?? "new"}:${eventEditing.date}`} event={data.calendarEvents.find(item => item.id === eventEditing.id)} date={eventEditing.date} calendars={activeCalendars} onClose={() => setEventEditing(null)} onSave={event => { mutate(value => saveCalendarEvent(value, event)); setEventEditing(null); }} onSaveTemplate={(event, name) => mutate(value => saveEventTemplate(value, event, name))} onDelete={id => { const stamp = new Date().toISOString(); mutate(value => ({ ...value, calendarEvents: value.calendarEvents.map(event => event.id === id ? { ...event, deletedAt: stamp, updatedAt: stamp, revision: event.revision + 1 } : event) })); setEventEditing(null); }} />}
    {scheduleEditing && <ScheduleEditor key={`${scheduleEditing.taskId}:${scheduleEditing.blockId ?? "new"}:${scheduleEditing.date}`} task={data.tasks.find(task => task.id === scheduleEditing.taskId)} block={data.blocks.find(item => item.id === scheduleEditing.blockId)} initialDate={scheduleEditing.date} onClose={() => setScheduleEditing(null)} onSave={block => { setScheduleUndo(data.blocks); mutate(value => saveScheduledBlock(value, block)); setScheduleEditing(null); }} />}
  </main>;
}

function CalendarEventEditor({ event, date, calendars, onClose, onSave, onSaveTemplate, onDelete }: {
  event?: CalendarEvent; date: string; calendars: Data["calendars"]; onClose: () => void;
  onSave: (event: CalendarEvent) => void; onSaveTemplate: (event: CalendarEvent, name: string) => void; onDelete: (id: string) => void;
}) {
  const timeZone = event && !event.allDay ? event.timeZone : zone();
  const parts = (instant?: string) => {
    if (!instant) return { day: date, time: "09:00" };
    const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    return { day: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
  };
  const startParts = event && !event.allDay ? parts(event.startInstant) : { day: event?.startDate ?? date, time: "09:00" };
  const endParts = event && !event.allDay ? parts(event.endInstant) : { day: event?.allDay ? addDays(event.endDate, -1) : date, time: "10:00" };
  const [title, setTitle] = useState(event?.title ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [calendarId, setCalendarId] = useState(event?.calendarId ?? calendars[0]?.id ?? "");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [startDate, setStartDate] = useState(startParts.day);
  const [endDate, setEndDate] = useState(endParts.day);
  const [startTime, setStartTime] = useState(startParts.time);
  const [endTime, setEndTime] = useState(endParts.time);
  const [frequency, setFrequency] = useState(event?.recurrence?.frequency ?? "");
  const [interval, setInterval] = useState(event?.recurrence?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(event?.recurrence?.weekdays ?? []);
  const [until, setUntil] = useState(event?.recurrence?.until ?? "");
  const [count, setCount] = useState(event?.recurrence?.count ? String(event.recurrence.count) : "");
  const startInstant = !allDay && startDate ? zonedDateTimeToInstant(startDate, startTime, timeZone) : undefined;
  const endInstant = !allDay && endDate ? zonedDateTimeToInstant(endDate, endTime, timeZone) : undefined;
  const invalid = !title.trim() || !calendarId || (allDay ? endDate < startDate : !startInstant || !endInstant || endInstant <= startInstant) || (Boolean(until) && until < startDate) || (Boolean(count) && Number(count) < 1);
  return <div className="modalBackdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><form className="editor" onSubmit={e => {
    e.preventDefault(); if (invalid) return;
    const base = event ?? { ...newEntity(), calendarId, title, notes, recurrence: undefined };
    const common = { ...base, calendarId, title: title.trim(), notes, updatedAt: new Date().toISOString(), revision: event ? event.revision + 1 : 1,
      recurrence: frequency ? { frequency: frequency as "daily" | "weekly" | "monthly" | "yearly", interval: Math.max(1, interval), weekdays: frequency === "weekly" ? weekdays : undefined, until: until || undefined, count: count ? Number(count) : undefined } : undefined };
    onSave(allDay ? { ...common, allDay: true, startDate, endDate: addDays(endDate, 1) } : { ...common, allDay: false, startInstant: startInstant!, endInstant: endInstant!, timeZone });
  }}>
    <div className="editorHead"><h2>{event ? "Edit event" : "New event"}</h2><button type="button" onClick={onClose} aria-label="Close editor">×</button></div>
    <label>Title<input required value={title} onChange={e => setTitle(e.target.value)} placeholder="What’s happening?" /></label>
    <label>Notes<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    <label>Calendar<select value={calendarId} onChange={e => setCalendarId(e.target.value)}>{calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></label>
    <label className="checkLabel"><input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} /> All day</label>
    <div className="fieldPair"><label>Starts<input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} /></label><label>Ends {allDay ? "(inclusive)" : ""}<input type="date" required value={endDate} onChange={e => setEndDate(e.target.value)} /></label></div>
    {!allDay && <><div className="fieldPair"><label>Start time<input type="time" required value={startTime} onChange={e => setStartTime(e.target.value)} /></label><label>End time<input type="time" required value={endTime} onChange={e => setEndTime(e.target.value)} /></label></div><p className="hint">Time zone: {timeZone}. Repeated events keep this local wall time across daylight saving changes.</p></>}
    <div className="fieldPair"><label>Repeat<select value={frequency} onChange={e => setFrequency(e.target.value)}><option value="">Never</option>{["daily", "weekly", "monthly", "yearly"].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>Every<input type="number" min="1" max="365" disabled={!frequency} value={interval} onChange={e => setInterval(Number(e.target.value))} /></label></div>
    {frequency === "weekly" && <fieldset><legend>Repeat on</legend>{calendarWeekdays.map((name, day) => <label className="checkLabel" key={name}><input type="checkbox" checked={weekdays.includes(day)} onChange={e => setWeekdays(e.target.checked ? [...weekdays, day] : weekdays.filter(value => value !== day))} /> {name}</label>)}</fieldset>}
    {frequency && <div className="fieldPair"><label>Repeat until<input type="date" min={startDate} value={until} onChange={e => setUntil(e.target.value)} /></label><label>End after occurrences<input type="number" min="1" value={count} onChange={e => setCount(e.target.value)} placeholder="No limit" /></label></div>}
    <div className="editorActions">{event && <><button type="button" onClick={() => {
      if (invalid) return;
      const name = prompt("Template name", title.trim());
      if (!name?.trim()) return;
      const base = { ...(event ?? newEntity()), calendarId, title: title.trim(), notes: notes.trim(), recurrence: undefined };
      onSaveTemplate(allDay ? { ...base, allDay: true, startDate, endDate: addDays(endDate, 1) } : { ...base, allDay: false, startInstant: startInstant!, endInstant: endInstant!, timeZone }, name.trim());
    }}>Save as template</button><button type="button" className="danger" onClick={() => { if (confirm("Delete this event series?")) onDelete(event.id); }}>Delete event series</button></>}<button type="button" onClick={onClose}>Cancel</button><button className="add" disabled={invalid}>Save event</button></div>
  </form></div>;
}

function ScheduleEditor({ task, block, initialDate, onClose, onSave }: {
  task?: Task; block?: ScheduledBlock; initialDate: string; onClose: () => void; onSave: (block: ScheduledBlock) => void;
}) {
  const timeZone = block?.timeZone ?? zone();
  const parts = (instant?: string) => {
    if (!instant) return { date: initialDate, time: "09:00" };
    const value = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    return { date: `${value.year}-${value.month}-${value.day}`, time: `${value.hour}:${value.minute}` };
  };
  const start = parts(block?.startInstant);
  const end = parts(block?.endInstant);
  const [startDate, setStartDate] = useState(start.date);
  const [endDate, setEndDate] = useState(end.date);
  const [startTime, setStartTime] = useState(start.time);
  const [endTime, setEndTime] = useState(block ? end.time : "10:00");
  const startInstant = zonedDateTimeToInstant(startDate, startTime, timeZone);
  const endInstant = zonedDateTimeToInstant(endDate, endTime, timeZone);
  const invalid = !task || Boolean(task.completedAt || task.deletedAt) || !startInstant || !endInstant || endInstant <= startInstant;
  return <div className="modalBackdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><form className="editor" onSubmit={e => {
    e.preventDefault(); if (invalid || !task || !startInstant || !endInstant) return;
    onSave({ ...(block ?? newEntity()), taskId: task.id, startInstant, endInstant, timeZone,
      updatedAt: new Date().toISOString(), revision: block ? block.revision + 1 : 1 });
  }}>
    <div className="editorHead"><h2>{block ? "Edit planned work" : "Schedule work"}</h2><button type="button" onClick={onClose} aria-label="Close schedule editor">×</button></div>
    <p className="hint"><strong>{task?.title ?? "Task unavailable"}</strong> · Scheduling work does not change its due date.</p>
    <div className="fieldPair"><label>Starts<input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} /></label><label>Ends<input type="date" required value={endDate} onChange={e => setEndDate(e.target.value)} /></label></div>
    <div className="fieldPair"><label>Start time<input type="time" required value={startTime} onChange={e => setStartTime(e.target.value)} /></label><label>End time<input type="time" required value={endTime} onChange={e => setEndTime(e.target.value)} /></label></div>
    <p className="hint">Time zone: {timeZone}. Overlapping work blocks remain visible as separate planned items.</p>
    <div className="editorActions"><button type="button" onClick={onClose}>Cancel</button><button className="add" disabled={invalid}>Save planned work</button></div>
  </form></div>;
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
    <label>Title<input required value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?" /></label>
    <label>Notes<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    <div className="fieldPair"><label>Date<input type="date" min={earliestDate} value={dueDate} onChange={e => setDueDate(e.target.value)} /></label><label>Time<input type="time" disabled={!dueDate} value={dueTime} onChange={e => setDueTime(e.target.value)} /></label></div>
    {expiredDueDate && <p className="hint">Choose a date within the seven-day history window.</p>}
    <div className="fieldPair"><label>Priority<select value={priority} onChange={e => setPriority(e.target.value as Priority)}>{priorities.map(p => <option key={p} value={p}>{priorityLabel(p)}</option>)}</select></label><label>Project<select value={projectId} onChange={e => { setProjectId(e.target.value); setSectionId(""); setParentTaskId(""); }}><option value="">Inbox</option>{data.projects.filter(p => !p.deletedAt && !p.archivedAt).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
    {projectId && <label>Section<select value={sectionId} onChange={e => setSectionId(e.target.value)}><option value="">Project root</option>{data.sections.filter(s => s.projectId === projectId && !s.deletedAt).map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>}
    <label>Subtask of<select value={parentTaskId} onChange={e => setParentTaskId(e.target.value)}><option value="">No parent</option>{data.tasks.filter(t => !t.deletedAt && !t.parentTaskId && t.id !== task?.id && (t.projectId ?? "") === projectId).map(t => <option value={t.id} key={t.id}>{t.title}</option>)}</select></label>
    {!!data.tags.length && <fieldset><legend>Tags</legend>{data.tags.filter(t => !t.deletedAt).map(t => <label className="checkLabel" key={t.id}><input type="checkbox" checked={tagIds.includes(t.id)} onChange={e => setTagIds(e.target.checked ? [...tagIds, t.id] : tagIds.filter(id => id !== t.id))} /> {t.name}</label>)}</fieldset>}
    <div className="fieldPair"><label>Repeat<select value={frequency} onChange={e => setFrequency(e.target.value)}><option value="">Never</option>{["daily", "weekly", "monthly", "yearly"].map(f => <option key={f} value={f}>{f}</option>)}</select></label><label>Every<input type="number" min="1" max="365" disabled={!frequency} value={interval} onChange={e => setInterval(Number(e.target.value))} /></label></div>
    {frequency === "weekly" && <fieldset><legend>Repeat on</legend>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name, day) => <label className="checkLabel" key={day}><input type="checkbox" checked={weekdays.includes(day)} onChange={e => setWeekdays(e.target.checked ? [...weekdays, day] : weekdays.filter(value => value !== day))} /> {name}</label>)}<p className="hint">If none are selected, repeat on the original weekday.</p></fieldset>}
    {frequency && <div className="fieldPair"><label>Repeat until<input type="date" min={dueDate} value={repeatUntil} onChange={e => setRepeatUntil(e.target.value)} /></label><label>End after occurrences<input type="number" min="1" value={repeatCount} onChange={e => setRepeatCount(e.target.value)} placeholder="No limit" /></label></div>}
    <label>Reminder before deadline<select value={reminderMinutes} onChange={e => setReminderMinutes(e.target.value)}><option value="">None</option><option value="0">At due time</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option><option value="1440">1 day</option></select></label>
    {reminderMinutes !== "" && !dueTime && <p className="hint">Choose a due date and time for a timed reminder.</p>}
    <div className="editorActions">{task && <button type="button" className="danger" onClick={() => { if (confirm("Delete this task?")) onDelete(task.id); }}>Delete task</button>}<button type="button" onClick={onClose}>Cancel</button><button className="add" disabled={!title.trim() || expiredDueDate}>Save task</button></div>
  </form></div>;
}
