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

  const calendarMonthStart = `${calendarMonth}-01`;
  const calendarMonthDate = parseLocalDate(calendarMonthStart);
  const calendarGridStart = calendarGridDates(calendarMonth)[0] ?? calendarMonthStart;
  const calendarDays = dashboardDays(data, calendarGridStart, 42, today);
  const calendarAgenda = calendarDays.find(day => day.date === calendarSelectedDate) ?? {
    date: calendarSelectedDate, due: [], scheduled: [], completed: []
  };
  const activeCalendars = data.calendars.filter(calendar => !calendar.deletedAt).sort((a, b) => a.sortKey - b.sortKey);
  const calendarEvents = calendarEventsForDay(data, calendarSelectedDate);
  const monthEventsByDay = new Map<string, ReturnType<typeof calendarEventsForDay>>();
  for (const item of calendarEventOccurrences(data, calendarGridStart, addDays(calendarGridStart, 42))) {
    const end = item.allDay ? item.endDate! : addDays(item.occurrenceDate, 1);
    for (let day = item.occurrenceDate; day < end; day = addDays(day, 1)) {
      monthEventsByDay.set(day, [...(monthEventsByDay.get(day) ?? []), item]);
    }
  }
  const timelineItems: CalendarTimelineItem[] = [
    ...calendarEvents.flatMap(item => {
      if (item.allDay || item.event.allDay || !item.startInstant || !item.endInstant) return [];
      const event = item.event;
      const color = activeCalendars.find(calendar => calendar.id === event.calendarId)?.color ?? "orange";
      const start = localDate(new Date(item.startInstant)) < calendarSelectedDate
        ? zonedDateTimeToInstant(calendarSelectedDate, "00:00", event.timeZone) ?? item.startInstant
        : item.startInstant;
      const lastEventDay = localDate(new Date(Date.parse(item.endInstant) - 1));
      const end = lastEventDay > calendarSelectedDate
        ? zonedDateTimeToInstant(addDays(calendarSelectedDate, 1), "00:00", event.timeZone) ?? item.endInstant
        : item.endInstant;
      return [{ id: `event:${event.id}:${item.occurrenceDate}`, title: event.title,
        caption: `${timeLabel(start)} – ${timeLabel(end)} · Event`, start, end, color }];
    }),
    ...calendarAgenda.scheduled.map(({ block, task }) => ({
      id: `block:${block.id}`, title: task.title,
      caption: `${timeLabel(block.startInstant)} – ${timeLabel(block.endInstant)} · Planned work`,
      start: block.startInstant, end: block.endInstant, color: "blue"
    })),
    ...calendarAgenda.due.filter(task => task.dueTime && !calendarAgenda.scheduled.some(item => item.task.id === task.id)).flatMap(task => {
      const start = zonedDateTimeToInstant(calendarSelectedDate, task.dueTime!, task.dueTimeZone ?? zone());
      if (!start) return [];
      const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
      return [{ id: `deadline:${task.id}`, title: task.title, caption: "Task deadline", start, end, color: "orange" }];
    })
  ];
  const calendarMonthLabel = calendarMonthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const shiftCalendarMonth = (offset: number) => {
    const next = new Date(calendarMonthDate);
    next.setMonth(next.getMonth() + offset);
    const month = localDate(next).slice(0, 7);
    setCalendarMonth(month);
    setCalendarSelectedDate(`${month}-01`);
  };
  const goCalendarToday = () => {
    const date = localDate(new Date());
    setCalendarMonth(date.slice(0, 7));
    setCalendarSelectedDate(date);
  };
  const dashboard = dashboardDays(data, visibleDayStart, dashboardWindow, today);
  return <main className="shell">
    <aside className="sidebar"><h1><span className="brandMark" aria-hidden="true" /> LTM Todo</h1><nav aria-label="Main navigation">{views.map(item => <button key={item} className={view === item ? "active" : ""} aria-current={view === item ? "page" : undefined} aria-label={item === "Settings" ? "Settings" : undefined} title={item === "Settings" ? "Settings" : undefined} onClick={() => {
      setProjectId("");
      if (item === "Dashboard" && view !== "Dashboard") {
        initialScrollPending.current = true;
        setDayStart(historyStart(today));
      } else if (item === "Dashboard") goToday();
      setView(item);
    }}><span className="navigationIcon"><TabIcon section={item} /></span>{item === "Settings" ? null : ` ${item}`}</button>)}</nav><div className="sidebarFoot">A calmer way through the day.</div></aside>
    <section className={`dashboard ${view === "Dashboard" ? "dashboardHome" : ""}`}>{error && <div className="error" role="alert">{error}</div>}
      {!ready ? <p>Opening your local tasks…</p> : <>
        <header className="pageHeader"><div><span className="eyebrow">YOUR SPACE</span><h2>{projectId && view === "Projects" ? projects.find(p => p.id === projectId)?.name : view}</h2><p>{view === "Dashboard" ? "A little clarity, one day at a time." : view === "Calendar" ? "Events, due dates, and planned work." : ""}</p></div><button className="add" onClick={() => setEditing(view === "Calendar" ? `new:${calendarSelectedDate}` : "new")}>+ Add task</button></header>
        {view === "Dashboard" && <><div className="streamControls"><button onClick={goToday}>Return to Today</button></div>
          <section className="stream overduePanel" aria-label="Overdue tasks"><div className="group overdue"><h4>OVERDUE</h4>{overdue.length ? overdue.map(task => taskRow(task, overdueDueCaption(task.dueDate!, today))) : <p className="overdueEmpty">Nothing overdue</p>}</div></section>
          <div className="stream dayScroller" ref={dayScrollRef} onScroll={handleDayScroll} role="region" aria-label="Days">
            <button className="loadMore" onClick={() => shiftDays(-1)} disabled={visibleDayStart <= earliestDay}>Earlier days ↑</button>
            {dashboard.map(day => {
            const past = day.date < today;
            const empty = !day.scheduled.length && !day.due.length && !day.completed.length;
            const label = day.date === today ? "TODAY" : day.date === addDays(today, 1) ? "TOMORROW" : dateLabel(day.date);
            return <article className={`day ${past ? "dayPast" : ""} ${empty ? "emptyDaySection" : ""}`} data-day={day.date} key={day.date} ref={day.date === today ? todayRef : undefined}>
            <div className="dayHeader"><h3 aria-label={`${label} ${day.date}`}>{label}</h3><time dateTime={day.date}>{day.date}</time></div>
            {!!day.scheduled.length && <div className="group"><h4>SCHEDULED</h4>{day.scheduled.map(({ block, task, completionId }) => taskRow(task, `${timeLabel(block.startInstant)} – ${timeLabel(block.endInstant)} · Work block${task.dueDate === day.date ? " · Also due today" : ""}`, completionId, `block:${block.id}`))}</div>}
            {!!day.due.length && <div className="group"><h4>DUE</h4>{day.due.map(task => taskRow(task, task.dueTime ? `Due ${dueTimeCaption(task.dueTime)}` : "Due today"))}</div>}
            {!!day.completed.length && <div className="group"><h4>COMPLETED</h4>{day.completed.map(item => taskRow(item.task, new Date(item.completedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), item.completionId || undefined, `completion:${item.completionId || item.task.id}:${item.completedAt}`))}</div>}
            {empty ? <div className={`emptyDay ${past ? "pastEmpty" : ""}`}><span>{past ? "No completed items" : "Nothing planned"}</span><button onClick={() => setEditing(`new:${day.date}`)}>+ Add</button></div> :
              <button className="dayAdd" onClick={() => setEditing(`new:${day.date}`)}>+ Add task for this day</button>}
          </article>})}
            <button className="loadMore" onClick={() => shiftDays(1)}>Later days ↓</button>
          </div>
        </>}
        {view === "Calendar" && <section className="calendarCard" aria-label="Calendar">
          <div className="calendarToolbar">
            <div className="calendarMonthControl"><button type="button" aria-label="Previous period" onClick={() => { if (calendarMode === "month") shiftCalendarMonth(-1); else setCalendarSelectedDate(addDays(calendarSelectedDate, calendarMode === "week" ? -7 : -1)); }}>‹</button><h3>{calendarMode === "month" ? calendarMonthLabel : dateLabel(calendarSelectedDate)}</h3><button type="button" aria-label="Next period" onClick={() => { if (calendarMode === "month") shiftCalendarMonth(1); else setCalendarSelectedDate(addDays(calendarSelectedDate, calendarMode === "week" ? 7 : 1)); }}>›</button></div>
            <div className="calendarActions"><select aria-label="Calendar view" value={calendarMode} onChange={e => setCalendarMode(e.target.value as typeof calendarMode)}><option value="month">Month</option><option value="week">Week</option><option value="day">Day</option><option value="agenda">Agenda</option></select><button type="button" className="calendarToday" onClick={goCalendarToday}>Today</button><button type="button" className="calendarToday" onClick={() => setEventEditing({ date: calendarSelectedDate })}>+ Event</button></div>
          </div>
          {scheduleUndo && <div className="scheduleUndo" role="status"><span>Planning change saved.</span><button type="button" onClick={() => { const blocks = scheduleUndo; mutate(value => ({ ...value, blocks })); setScheduleUndo(null); }}>Undo</button></div>}
          <div className="calendarManagement"><div className="calendarToggles" aria-label="Visible calendars">{activeCalendars.map(calendar => <label key={calendar.id}><input type="checkbox" checked={calendar.visible} onChange={e => mutate(value => ({ ...value, calendars: value.calendars.map(item => item.id === calendar.id ? { ...item, visible: e.target.checked, updatedAt: new Date().toISOString(), revision: item.revision + 1 } : item) }))} /><span className={`calendarColor calendarColor-${calendar.color}`} />{calendar.name}</label>)}</div><button type="button" onClick={() => { const name = prompt("Calendar name")?.trim(); if (!name) return; const color = calendarColors[activeCalendars.length % calendarColors.length]; const calendar = createCalendar(name, color); if (calendar) mutate(value => ({ ...value, calendars: [...value.calendars, calendar] })); }}>+ Calendar</button></div>
          <div className="calendarLayout">
            <div>
              <div className="calendarWeekdays" aria-hidden="true">{calendarWeekdays.map(day => <span key={day}>{day}</span>)}</div>
              <div className={`calendarGrid ${calendarMode !== "month" ? "calendarCompactGrid" : ""}`} role="group" aria-label={`Dates in ${calendarMonthLabel}`}>
                {(calendarMode === "month" ? calendarDays : calendarMode === "week" ? Array.from({ length: 7 }, (_, i) => ({ date: addDays(calendarSelectedDate, i - parseLocalDate(calendarSelectedDate).getDay()) })) : calendarMode === "agenda" ? Array.from({ length: 14 }, (_, i) => ({ date: addDays(calendarSelectedDate, i) })) : [{ date: calendarSelectedDate }]).map(day => {
                  const taskDay = calendarDays.find(item => item.date === day.date);
                  const dayEvents = monthEventsByDay.get(day.date) ?? [];
                  const eventCount = dayEvents.length;
                  const itemCount = (taskDay?.scheduled.length ?? 0) + (taskDay?.due.length ?? 0) + (taskDay?.completed.length ?? 0) + eventCount;
                  const previews = [
                    ...dayEvents.map(item => ({ id: `event:${item.event.id}:${item.occurrenceDate}`, title: item.event.title,
                      color: activeCalendars.find(calendar => calendar.id === item.event.calendarId)?.color ?? "orange" })),
                    ...(taskDay?.scheduled ?? []).map(item => ({ id: `block:${item.block.id}`, title: item.task.title, color: "blue" })),
                    ...(taskDay?.due ?? []).map(task => ({ id: `due:${task.id}`, title: task.title, color: "orange" }))
                  ].slice(0, 2);
                  return <button key={day.date} type="button" className={"calendarDay" + (day.date.slice(0, 7) !== calendarMonth ? " calendarDayOutsideMonth" : "") + (day.date === calendarSelectedDate ? " calendarDaySelected" : "") + (day.date === today ? " calendarDayToday" : "")}
                    aria-label={dateLabel(day.date) + (itemCount ? `, ${itemCount} calendar item${itemCount === 1 ? "" : "s"}` : ", no calendar items")}
                    aria-current={day.date === today ? "date" : undefined} aria-pressed={day.date === calendarSelectedDate}
                    onClick={() => { setCalendarSelectedDate(day.date); if (day.date.slice(0, 7) !== calendarMonth) setCalendarMonth(day.date.slice(0, 7)); }}
                    onDragOver={e => { if (e.dataTransfer.types.includes("application/x-ltm-task")) e.preventDefault(); }}
                    onDrop={e => { e.preventDefault(); const taskId = e.dataTransfer.getData("application/x-ltm-task"); if (!taskId || !data.tasks.some(task => task.id === taskId && !task.completedAt && !task.deletedAt)) return; setCalendarSelectedDate(day.date); setScheduleEditing({ taskId, date: day.date }); }}>
                    <span>{calendarMode === "agenda" ? dateLabel(day.date) : parseLocalDate(day.date).getDate()}</span>
                    <div className="calendarDayPreviews" aria-hidden="true">{previews.map(item => <span key={item.id} className="calendarDayPreview"><i className={`calendarColor calendarColor-${item.color}`} />{item.title}</span>)}</div>
                    {itemCount > previews.length && <small aria-hidden="true">+{itemCount - previews.length} more</small>}
                  </button>;
                })}
              </div>
            </div>
            <div className="calendarAgenda" aria-live="polite">
              <div className="calendarAgendaHeader"><div><span className="eyebrow">SELECTED DAY</span><h3>{dateLabel(calendarSelectedDate)}</h3></div></div>
              <h4 className="calendarTimelineHeading">TIMELINE {calendarSelectedDate === today && <span>Now · {timeLabel(calendarNow.toISOString())}</span>}</h4>
              <CalendarTimeline day={calendarSelectedDate} items={timelineItems} now={calendarNow} />
              {!!calendarAgenda.scheduled.length && <div className="group"><h4>PLANNED WORK</h4>{calendarAgenda.scheduled.map(({ block, task, completionId }) => <div className="plannedRow" key={`calendar-block:${block.id}`}>{taskRow(task, `${timeLabel(block.startInstant)} – ${timeLabel(block.endInstant)} · Work block${task.dueDate === calendarSelectedDate ? " · Also due today" : ""}`, completionId, `calendar-block-task:${block.id}`)}<button type="button" className="scheduleAction" aria-label={`Edit scheduled block for ${task.title}`} onClick={() => setScheduleEditing({ taskId: task.id, blockId: block.id, date: calendarSelectedDate })}>Edit time</button><button type="button" className="scheduleAction" aria-label={`Unschedule ${task.title}`} onClick={() => { setScheduleUndo(data.blocks); mutate(value => deleteScheduledBlock(value, block.id)); }}>Remove</button></div>)}</div>}
              {!!calendarAgenda.due.length && <div className="group"><h4>DUE</h4>{calendarAgenda.due.map(task => taskRow(task, task.dueTime ? `Due ${dueTimeCaption(task.dueTime)}` : "Due today"))}</div>}
              {!!calendarAgenda.completed.length && <div className="group"><h4>COMPLETED</h4>{calendarAgenda.completed.map(item => taskRow(item.task, new Date(item.completedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), item.completionId || undefined, `calendar-completion:${item.completionId || item.task.id}:${item.completedAt}`))}</div>}
              {!!calendarEvents.length && <div className="group"><h4>EVENTS</h4>{calendarEvents.map(item => <div className="eventRow" key={`${item.event.id}:${item.occurrenceDate}`}><span className={`calendarColor calendarColor-${activeCalendars.find(c => c.id === item.event.calendarId)?.color ?? "orange"}`} /><button type="button" className="eventTitle" onClick={() => setEventEditing({ id: item.event.id, date: item.occurrenceDate })}><strong>{item.event.title}</strong><small>{item.allDay ? "All day" : `${timeLabel(item.startInstant!)} – ${timeLabel(item.endInstant!)}`} · {activeCalendars.find(c => c.id === item.event.calendarId)?.name ?? "Calendar"}</small></button></div>)}</div>}
              {!calendarAgenda.scheduled.length && !calendarAgenda.due.length && !calendarAgenda.completed.length && !calendarEvents.length && <p className="calendarEmpty">Nothing planned for this day.</p>}
              <button className="linkButton" type="button" onClick={() => setEditing(`new:${calendarSelectedDate}`)}>+ Add task for this day</button>
            </div>
          </div>
        </section>}
        {view === "Tasks" && <>
          <form className="quickAdd" onSubmit={e => { e.preventDefault(); addTask(quickTitle); }}><span aria-hidden>＋</span><input aria-label="Quick add task" placeholder="Add a task…" value={quickTitle} onChange={e => setQuickTitle(e.target.value)} /><button disabled={!quickTitle.trim()}>Add</button></form>
          {view === "Tasks" && <><div className="filters"><input aria-label="Search tasks" placeholder="Search titles and notes…" value={query} onChange={e => setQuery(e.target.value)} /><select aria-label="Filter status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="open">Open</option><option value="completed">Completed</option><option value="all">All statuses</option></select><select aria-label="Filter project" value={taskProjectFilter} onChange={e => setTaskProjectFilter(e.target.value)}><option value="all">All projects</option><option value="inbox">Inbox</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select aria-label="Filter priority" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as Priority | "all")}><option value="all">All priorities</option>{priorities.map(p => <option key={p} value={p}>{priorityLabel(p)}</option>)}</select><select aria-label="Filter tag" value={tagFilter} onChange={e => setTagFilter(e.target.value)}><option value="">All tags</option>{tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><select aria-label="Filter due date" value={dateFilter} onChange={e => setDateFilter(e.target.value as DateScope | "all")}><option value="all">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="upcoming">Upcoming</option><option value="undated">No due date</option></select></div><p className="filterSummary" aria-live="polite">{visible.length} results · {activeFilters || "No filters"}</p><div className="bulkActions"><button type="button" aria-pressed={kanbanMode} onClick={() => setKanbanMode(false)}>List</button><button type="button" aria-pressed={kanbanMode} onClick={() => setKanbanMode(true)}>Kanban</button>{kanbanMode && <label>Group by <select aria-label="Kanban grouping" value={kanbanGrouping} onChange={e => setKanbanGrouping(e.target.value as typeof kanbanGrouping)}><option value="status">Status</option><option value="priority">Priority</option></select></label>}<button onClick={() => { const name = prompt("Name this saved view")?.trim(); if (!name) return; mutate(value => ({ ...value, savedViews: [...value.savedViews, { ...newEntity(), name, query, projectId: taskProjectFilter === "all" ? undefined : taskProjectFilter === "inbox" ? null : taskProjectFilter, priority: priorityFilter, tagId: tagFilter || undefined, dateScope: dateFilter, completed: statusFilter === "all" ? "all" : statusFilter === "completed" }] })); }}>Save current filters</button><select aria-label="Saved views" value={savedViewId} onChange={e => { const id = e.target.value; setSavedViewId(id); const saved = data.savedViews.find(item => item.id === id); if (!saved) return; setQuery(saved.query); setTaskProjectFilter(saved.projectId === undefined ? "all" : saved.projectId === null ? "inbox" : saved.projectId); setPriorityFilter(saved.priority ?? "all"); setTagFilter(saved.tagId ?? ""); setDateFilter(saved.dateScope ?? "all"); setStatusFilter(saved.completed === "all" ? "all" : saved.completed ? "completed" : "open"); }}><option value="">Saved views…</option>{data.savedViews.filter(item => !item.deletedAt).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button disabled={!savedViewId} aria-label="Delete selected saved view" onClick={() => { const id = savedViewId; mutate(value => ({ ...value, savedViews: value.savedViews.map(item => item.id === id ? { ...item, deletedAt: new Date().toISOString(), revision: item.revision + 1 } : item) })); setSavedViewId(""); }}>Delete view</button><label>Priority <select aria-label="Bulk priority" value={bulkPriority} onChange={e => setBulkPriority(e.target.value as Priority)}>{priorities.map(priority => <option value={priority} key={priority}>{priorityLabel(priority)}</option>)}</select></label><button disabled={!selectedTaskIds.length} onClick={() => { mutate(value => bulkSetPriority(value, selectedTaskIds, bulkPriority)); setSelectedTaskIds([]); }}>Set selected priority</button><button disabled={!selectedTaskIds.length} onClick={() => { const templates = data.tasks.filter(task => selectedTaskIds.includes(task.id)).map(task => ({ ...newEntity(), name: task.title, title: task.title, notes: task.notes, priority: task.priority, projectId: task.projectId, sectionId: task.sectionId, tagIds: [...task.tagIds] })); mutate(value => templates.reduce((next, template) => saveTaskTemplate(next, template), value)); setSelectedTaskIds([]); }}>Save selected as templates</button><button disabled={!selectedTaskIds.length} onClick={() => { mutate(value => bulkCompleteTasks(value, selectedTaskIds)); setSelectedTaskIds([]); }}>Complete selected ({selectedTaskIds.length})</button><button disabled={!selectedTaskIds.length} onClick={() => setSelectedTaskIds([])}>Clear selection</button></div></>}
          {!kanbanMode ? <div className="listPanel">{visible.map(t => <div className="bulkTaskRow" key={t.id}><input type="checkbox" aria-label={`Select ${t.title}`} checked={selectedTaskIds.includes(t.id)} onChange={e => setSelectedTaskIds(currentIds => e.target.checked ? [...currentIds, t.id] : currentIds.filter(id => id !== t.id))} />{taskRow(t)}</div>)}{!visible.length && <div className="empty">All clear here. Add a task whenever you&apos;re ready.</div>}</div>
            : <div className="kanbanBoard" aria-label={`Tasks grouped by ${kanbanGrouping}`}>{kanbanGroups.map(group => <section className="kanbanColumn" key={group.key} aria-label={`${group.label}, ${group.tasks.length} tasks`}><h3>{group.label}<small>{group.tasks.length}</small></h3>{group.tasks.map(task => <article className="kanbanCard" key={task.id}>{taskRow(task)}{kanbanGrouping === "priority" && <label>Priority<select aria-label={`Priority for ${task.title}`} value={task.priority} onChange={e => mutate(value => bulkSetPriority(value, [task.id], e.target.value as Priority))}>{priorities.map(priority => <option key={priority} value={priority}>{priorityLabel(priority)}</option>)}</select></label>}</article>)}</section>)}</div>}
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
        {view === "Settings" && <div className="settingsPanel"><h3>Local and private</h3><p>Your tasks are stored on this device. To deliver reminders while the app is closed, reminder titles and scheduled times are sent to LTM Todo&apos;s Cloudflare reminder service. Each device has its own notification subscription.</p><button onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `ltm-todo-${today}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download backup JSON</button>
          <h3>Task templates</h3><p>Templates create fresh tasks with their own IDs and completion history.</p>{data.taskTemplates.filter(template => !template.deletedAt).map(template => <div className="tagLine" key={template.id}><span><strong>{template.name}</strong><small> · {template.title}</small></span><button type="button" onClick={() => mutate(value => instantiateTaskTemplate(value, template.id))}>Create task</button></div>)}{!data.taskTemplates.some(template => !template.deletedAt) && <p>No templates yet. Select tasks in Tasks and choose “Save selected as templates.”</p>}
          <h3>Event templates</h3><p>Start a new calendar event from a saved event pattern.</p>{data.eventTemplates.filter(template => !template.deletedAt).map(template => <div className="tagLine" key={template.id}><span><strong>{template.name}</strong><small> · {template.title}</small></span><button type="button" onClick={() => mutate(value => instantiateEventTemplate(value, template.id, calendarSelectedDate))}>Create event on {calendarSelectedDate}</button></div>)}{!data.eventTemplates.some(template => !template.deletedAt) && <p>No event templates yet. Save an existing event as a template in its editor.</p>}
           <h3>Routines</h3><p>A routine starts a recurring task from a template. Completing that task advances its next due date.</p><form className="routineForm" onSubmit={e => { e.preventDefault(); if (!routineTemplateId) return; const form = e.currentTarget; const name = (form.elements.namedItem("routineName") as HTMLInputElement).value.trim(); if (!name) return; mutate(value => createRoutine(value, routineTemplateId, name, routineStartDate, { frequency: routineFrequency, interval: Math.max(1, routineInterval) })); (form.elements.namedItem("routineName") as HTMLInputElement).value = ""; }}><label>Routine name<input name="routineName" required placeholder="Weekly review" /></label><label>Template<select aria-label="Routine template" value={routineTemplateId} onChange={e => setRoutineTemplateId(e.target.value)}><option value="">Choose template…</option>{data.taskTemplates.filter(template => !template.deletedAt).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label><div className="fieldPair"><label>First due date<input type="date" min={historyStart(today)} value={routineStartDate} onChange={e => setRoutineStartDate(e.target.value)} /></label><label>Repeat<select value={routineFrequency} onChange={e => setRoutineFrequency(e.target.value as typeof routineFrequency)}>{["daily", "weekly", "monthly", "yearly"].map(frequency => <option key={frequency} value={frequency}>{frequency}</option>)}</select></label></div><label>Every<input type="number" min="1" max="365" value={routineInterval} onChange={e => setRoutineInterval(Number(e.target.value))} /></label><button disabled={!routineTemplateId}>Create routine</button></form>{data.routines.filter(routine => !routine.deletedAt).map(routine => <div className="tagLine" key={routine.id}><span>{routine.name} · {routine.recurrence.frequency}</span><button type="button" onClick={() => mutate(value => setRoutineEnabled(value, routine.id, !routine.enabled))}>{routine.enabled ? "Pause" : "Resume"}</button></div>)}
          <h3>Push reminders</h3><p>Enable push for notifications when LTM Todo is in the background or closed. On iPhone or iPad, open the Home Screen app copy to enable push. Push scheduling checks once per minute, so delivery can be slightly after the selected time.</p>
          <p>Browser permission: {pushPermission === "granted" ? "Allowed" : pushPermission === "denied" ? "Blocked in browser settings" : pushPermission === "unsupported" ? "Not supported" : "Not granted"}. Push subscription: {pushActive ? "Set up on this device" : "Not set up"}.</p>
          <p role="status" aria-live="polite">{pushStatus}</p>
          {!pushSupported ? <p>Push notifications are not available in this browser context.</p> : <div className="settingsActions">{!pushActive && <button disabled={pushBusy} onClick={() => { void (async () => {
            setPushBusy(true);
            try {
              const token = await registerPushDevice(await pushConfig(), true);
              setPushPermission(Notification.permission); setPushToken(token); setPushActive(true); setPushStatus("Push notifications are set up on this device.");
            } catch (cause) { setPushPermission(Notification.permission); setPushStatus(cause instanceof Error ? cause.message : "Push notifications could not be enabled."); }
            finally { setPushBusy(false); }
          })(); }}>{pushBusy ? "Setting up…" : pushPermission === "granted" ? "Retry push setup" : "Enable push notifications"}</button>}
            {pushActive && <button disabled={pushBusy} onClick={() => setPushSyncRevision(value => value + 1)}>Sync reminders now</button>}
            <button disabled={pushBusy} onClick={() => { void (async () => {
              setPushBusy(true);
              try {
                let token = pushToken;
                if (!pushActive || !token) {
                  token = await registerPushDevice(await pushConfig(), true);
                  setPushPermission(Notification.permission); setPushToken(token); setPushActive(true);
                }
                const response = await fetch("/api/notifications/test", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
                if (!response.ok) throw new Error("The test notification could not be sent. Re-enable notifications if this device subscription expired.");
                setPushStatus("Test push sent. Check this device’s notification center.");
              } catch (cause) { setPushPermission(Notification.permission); setPushStatus(cause instanceof Error ? cause.message : "The test notification could not be sent."); }
              finally { setPushBusy(false); }
            })(); }}>Send test notification</button>
            {pushActive && <button disabled={pushBusy} onClick={() => { void (async () => {
              setPushBusy(true);
              try {
                await removePushDevice(pushToken);
                setPushToken(""); setPushActive(false); setPushStatus("Push notifications are disabled on this device.");
              } catch { setPushStatus("Push notifications could not be disabled right now. Please retry."); }
              finally { setPushBusy(false); }
            })(); }}>Disable on this device</button>}
          </div>}
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
