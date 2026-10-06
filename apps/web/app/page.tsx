"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type UIEvent } from "react";
import { addDays, calendarGridDates, completeTask, createRoutine, dashboardDays, deleteSection, deleteScheduledBlock, emptyData, filterTasks, historyStart, instantiateTaskTemplate, localDate, newEntity, overdueTasks, parseLocalDate, scheduledReminderTriggers, pruneExpiredHistory, reorderProject, reorderSection, reorderTask, saveScheduledBlock, saveTask, saveTaskTemplate, setRoutineEnabled, taskDueDateOrder, undoCompletion, type CalendarColor, type CalendarEvent, type Data, type Priority, type ScheduledBlock, type Task, type TaskTemplate } from "../lib/domain";
import { defaultCalendarColor, normalizeCalendarColor, calendarEventsForDay, calendarEventOccurrences, createCalendar, updateCalendar, instantiateEventTemplate, saveCalendarEvent, saveEventTemplate, zonedDateTimeToInstant } from "../lib/calendar-domain";
import { acknowledgeSyncMutation, applyRemoteSyncChanges, bindSyncAccount, getSyncCursor, getSyncSnapshotCursor, hasSyncConflicts, persistSyncCursor, persistSyncSnapshotCursor, persistIcsCalendarCache, prepareInitialSyncUpload, readData, readIcsCalendarCache, readPendingSyncMutations, readSyncConflicts, recordSyncConflict, resolveSyncConflict, writeData, type CachedIcsCalendar, type SyncConflict } from "../lib/storage";
import { getLocalSyncDeviceId, SyncClient, type SyncStatus } from "../lib/sync-client";
import { describeSyncFailure } from "../lib/sync-diagnostics";
import { readAccountSignInStatus, type AccountSignInStatus } from "../lib/auth-sign-in-status";
import type { SyncDevice } from "../lib/device-registry";
import { createBackup, parseBackup, MAX_BACKUP_BYTES } from "../lib/backup";
import type { AttachmentRecord } from "../lib/attachment-api";
import { syncPendingAttachmentUploads } from "../lib/attachment-client";
import { queueAttachmentUpload, readPendingAttachmentUploads, type PendingAttachmentUpload } from "../lib/storage";
import { dueTimeCaption, overdueDueCaption } from "../lib/date-labels";
import { TabIcon, type NavigationSection } from "../components/TabIcon";
import { CalendarTimeline, type CalendarTimelineItem } from "../components/CalendarTimeline";
import { CustomSelect, DateField, TimeField } from "../components/CustomFields";
import { CalendarColorPicker } from "../components/CalendarColorPicker";
import { OutlineImporter } from "../components/OutlineImporter";
import { importOutlineItems } from "../lib/outline-import";
import { toReadOnlyCalendarEvent } from "../lib/ics-calendar-view";
import { defaultWeekdaysForRepeat, recurrenceForRepeat, repeatLabelFor, repeatOptionsFor, repeatSelectionFor, repeatUsesWeekdayPicker, type RepeatSelection } from "../lib/recurrence-presets";
import { availableWorkSlots, type BusyTimeRange } from "../lib/schedule-slots";

type View = NavigationSection;
const views: View[] = ["Dashboard", "Tasks", "Projects", "Calendar", "Settings"];
const priorities: Priority[] = ["low", "medium", "high"];
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
  const [calendarNow, setCalendarNow] = useState(() => new Date());
  const [eventEditing, setEventEditing] = useState<{ id?: string; date: string } | null>(null);
  const [calendarCreating, setCalendarCreating] = useState(false);
  const [calendarDeleteConfirm, setCalendarDeleteConfirm] = useState<string | null>(null);
  const [calendarEditingId, setCalendarEditingId] = useState<string | null>(null);
  const [calendarName, setCalendarName] = useState("");
  const [calendarColor, setCalendarColor] = useState<CalendarColor>(defaultCalendarColor);
  const [icsCalendarCache, setIcsCalendarCache] = useState<CachedIcsCalendar[]>([]);
  const [icsSubscribeOpen, setIcsSubscribeOpen] = useState(false);
  const [icsFeedUrl, setIcsFeedUrl] = useState("");
  const [icsFeedName, setIcsFeedName] = useState("");
  const [icsFeedColor, setIcsFeedColor] = useState<CalendarColor>(defaultCalendarColor);
  const [icsFeedBusy, setIcsFeedBusy] = useState(false);
  const [icsFeedStatus, setIcsFeedStatus] = useState("");
  const [scheduleEditing, setScheduleEditing] = useState<{ taskId: string; blockId?: string; date: string } | null>(null);
  const [scheduleUndo, setScheduleUndo] = useState<ScheduledBlock[] | null>(null);
  const [dashboardComposerOpen, setDashboardComposerOpen] = useState(false);
  const [dashboardComposerTab, setDashboardComposerTab] = useState<"task" | "event">("task");
  const [dashboardComposerDate, setDashboardComposerDate] = useState<string | undefined>();
  const [dashboardComposerProject, setDashboardComposerProject] = useState<string | undefined>();
  const [editing, setEditing] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [query, setQuery] = useState("");
  const [routineTemplateId, setRoutineTemplateId] = useState("");
  const [routineStartDate, setRoutineStartDate] = useState(() => localDate(new Date()));
  const [routineRepeatSelection, setRoutineRepeatSelection] = useState<RepeatSelection>("weekly");
  const [routineWeekdays, setRoutineWeekdays] = useState<number[]>([]);
  const [pushToken, setPushToken] = useState("");
  const [pushActive, setPushActive] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">("default");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushStatus, setPushStatus] = useState("Checking push notification support…");
  const [pushSyncRevision, setPushSyncRevision] = useState(0);
  const pushSyncQueue = useRef(Promise.resolve());
  const syncClient = useRef<SyncClient | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ state: "idle" });
  const [authSignInStatus, setAuthSignInStatus] = useState<AccountSignInStatus>("checking");
  const accountSyncAvailable = Boolean(syncStatus.authenticated && syncStatus.state !== "account_mismatch");
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [syncDevices, setSyncDevices] = useState<SyncDevice[]>([]);
  const [deviceStatus, setDeviceStatus] = useState("");
  const [authSessions, setAuthSessions] = useState<Array<{ sessionKey: string; createdAt: string; expiresAt: string; lastSeenAt: string; current: boolean }>>([]);
  const [authSessionStatus, setAuthSessionStatus] = useState("");
  const [accountStatus, setAccountStatus] = useState("");
  const [currentSyncDeviceId, setCurrentSyncDeviceId] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const [outlineImportOpen, setOutlineImportOpen] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [attachmentTaskId, setAttachmentTaskId] = useState("");
  const [attachmentStatus, setAttachmentStatus] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachmentUpload[]>([]);
  const [today, setToday] = useState(() => localDate(new Date()));
  const [dayStart, setDayStart] = useState(() => historyStart(localDate(new Date())));
  const earliestDay = historyStart(today);
  const visibleDayStart = dayStart < earliestDay ? earliestDay : dayStart;
  const todayRef = useRef<HTMLElement>(null);
  const dayScrollRef = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<{ day: string; top: number } | null>(null);
  const windowShiftLock = useRef(false);
  const initialScrollPending = useRef(true);
  const rememberDashboardAnchor = useCallback(() => {
    const scroller = dayScrollRef.current;
    if (!scroller) return;
    const bounds = scroller.getBoundingClientRect();
    const anchor = [...scroller.querySelectorAll<HTMLElement>("[data-day]")].find(element => element.getBoundingClientRect().bottom > bounds.top);
    if (anchor?.dataset.day) pendingAnchor.current = { day: anchor.dataset.day, top: anchor.getBoundingClientRect().top - bounds.top };
  }, []);
  useEffect(() => { readData().then(value => { setCurrentSyncDeviceId(getLocalSyncDeviceId()); current.current = value; setData(value); setReady(true); })
    .catch(() => { setError("Local storage could not be opened. Changes are disabled."); setReady(true); }); }, []);
  useEffect(() => { void readIcsCalendarCache().then(setIcsCalendarCache).catch(() => undefined); }, []);
  useEffect(() => { void readPendingAttachmentUploads().then(setPendingAttachments).catch(() => setAttachmentStatus("Local attachment queue could not be opened.")); }, []);
  useEffect(() => {
    if (!syncStatus.authenticated) return;
    let cancelled = false;
    void fetch("/api/v1/devices", { credentials: "same-origin", cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Registered devices are unavailable.");
      const result = await response.json() as { devices?: SyncDevice[] };
      if (!cancelled) setSyncDevices(Array.isArray(result.devices) ? result.devices : []);
    }).catch(() => setDeviceStatus("Registered devices could not be loaded."));
    return () => { cancelled = true; };
  }, [syncStatus.authenticated]);
  useEffect(() => {
    if (!syncStatus.authenticated) return;
    let cancelled = false;
    void fetch("/api/v1/auth/sessions", { credentials: "same-origin", cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Active sessions are unavailable.");
      const result = await response.json() as { sessions?: typeof authSessions };
      if (!cancelled) setAuthSessions(Array.isArray(result.sessions) ? result.sessions : []);
    }).catch(() => { if (!cancelled) setAuthSessionStatus("Active sessions could not be loaded."); });
    return () => { cancelled = true; };
  }, [syncStatus.authenticated]);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let requestId = 0;
    const refreshSignInStatus = () => {
      const currentRequestId = ++requestId;
      void readAccountSignInStatus().then(status => {
        if (!cancelled && currentRequestId === requestId) setAuthSignInStatus(current => status === "unavailable" && (current === "signed_in" || current === "signed_out") ? current : status);
      });
    };
    refreshSignInStatus();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshSignInStatus();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [ready]);
  useEffect(() => {
    if (!ready || error) return;
    const client = new SyncClient({ deviceName: `Web · ${navigator.platform || "browser"}`, outbox: {
      bindAccount: bindSyncAccount,
      prepareUpload: prepareInitialSyncUpload,
      pending: readPendingSyncMutations,
      acknowledge: acknowledgeSyncMutation,
      recordConflict: recordSyncConflict,
      cursor: getSyncCursor,
      setCursor: persistSyncCursor,
      snapshotCursor: getSyncSnapshotCursor,
      setSnapshotCursor: persistSyncSnapshotCursor,
      applyRemote: async changes => {
        const apply = writes.current.catch(() => undefined).then(async () => {
          if (writeFailed.current) throw new Error("Local writes are paused");
          await applyRemoteSyncChanges(changes);
          const latest = await readData();
          rememberDashboardAnchor();
          current.current = latest;
          setData(latest);
        });
        writes.current = apply.catch(() => undefined);
        await apply;
      },
      hasConflicts: hasSyncConflicts
    }, onStatus: status => {
      setSyncStatus(status);
      if (status.state === "conflict") void readSyncConflicts().then(setSyncConflicts);
    } });
    syncClient.current = client;
    const retry = () => {
      void client.syncNow();
      void syncPendingAttachmentUploads().then(async result => {
        setPendingAttachments(await readPendingAttachmentUploads());
        if (result.uploaded) {
          setAttachmentStatus(`${result.uploaded} attachment${result.uploaded === 1 ? "" : "s"} uploaded.`);
          void fetch("/api/v1/attachments", { credentials: "same-origin", cache: "no-store" }).then(response => response.ok ? response.json() as Promise<{ attachments?: AttachmentRecord[] }> : undefined)
            .then(result => { if (result?.attachments) setAttachments(result.attachments); }).catch(() => undefined);
        }
      }).catch(() => undefined);
    };
    const visible = () => { if (document.visibilityState === "visible") retry(); };
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(retry, 60_000);
    void client.syncNow();
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", visible);
      window.clearInterval(timer);
      client.dispose();
      if (syncClient.current === client) syncClient.current = null;
    };
  }, [ready, error, rememberDashboardAnchor]);
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
    const upcoming = scheduledReminderTriggers(data);
    const configuredCount = data.reminders.filter(reminder => {
      const task = data.tasks.find(item => item.id === reminder.taskId);
      return !reminder.deletedAt && reminder.enabled && task && !task.deletedAt && !task.completedAt;
    }).length;
    const reminders = upcoming.slice(0, 5_000).map(({ reminder, task, triggerAt }) => ({
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
        const total = upcoming.length;
        setPushStatus(reminders.length < total
          ? `First ${reminders.length.toLocaleString()} of ${total.toLocaleString()} upcoming reminders synced; this device supports up to 5,000 scheduled reminders.`
          : total > 0
            ? `${total} upcoming reminder${total === 1 ? "" : "s"} synced to this device.`
            : configuredCount > 0
              ? `0 upcoming reminders synced. ${configuredCount} enabled task reminder${configuredCount === 1 ? " has" : "s have"} no future notification time; its notification time may already have passed.`
              : "No active task reminders to sync.");
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
  }, [visibleDayStart, data]);
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
      if (!writeFailed.current) return writeData(next, previous.generation).then(() => { void syncClient.current?.syncNow(); });
    }).catch((cause) => {
      writeFailed.current = true;
      setError(cause instanceof Error && cause.message.includes("another tab") ? cause.message :
      "Changes could not be saved. Download an unsaved backup from Settings before reloading this tab.");
    });
  }, [error, today]);
  useEffect(() => {
    if (!accountSyncAvailable) return;
    let cancelled = false;
    void fetch("/api/v1/calendars/subscriptions", { credentials: "same-origin", cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Calendar subscriptions are unavailable.");
      const result = await response.json() as { subscriptions?: CachedIcsCalendar[] };
      if (!Array.isArray(result.subscriptions)) throw new Error("Calendar subscriptions are invalid.");
      if (cancelled) return;
      const subscriptions = result.subscriptions;
      const previousSubscriptions = await readIcsCalendarCache().catch(() => []);
      if (cancelled) return;
      setIcsCalendarCache(subscriptions);
      await persistIcsCalendarCache(subscriptions);
      const byCalendar = new Map(subscriptions.map(subscription => [subscription.calendarId, subscription]));
      const currentCalendarIds = new Set(byCalendar.keys());
      const removedCalendarIds = new Set(previousSubscriptions.filter(subscription => !currentCalendarIds.has(subscription.calendarId)).map(subscription => subscription.calendarId));
      mutate(value => {
        let changed = false;
        const now = new Date().toISOString();
        const calendars = value.calendars.map(calendar => {
          if (removedCalendarIds.has(calendar.id) && !calendar.deletedAt) {
            changed = true;
            return { ...calendar, deletedAt: now, updatedAt: now, revision: calendar.revision + 1 };
          }
          const subscription = byCalendar.get(calendar.id);
          const color = subscription && normalizeCalendarColor(subscription.color);
          if (!subscription || !color || calendar.deletedAt ||
              calendar.name === subscription.name && calendar.color === color && calendar.visible === subscription.visible) return calendar;
          changed = true;
          return { ...calendar, name: subscription.name, color, visible: subscription.visible,
            updatedAt: now, revision: calendar.revision + 1 };
        });
        const known = new Set(calendars.map(calendar => calendar.id));
        for (const subscription of subscriptions) {
          if (known.has(subscription.calendarId)) continue;
          const color = normalizeCalendarColor(subscription.color) ?? defaultCalendarColor;
          calendars.push({ ...newEntity(), id: subscription.calendarId, name: subscription.name, color,
            visible: subscription.visible, sortKey: Date.now() + calendars.length });
          changed = true;
        }
        if (!changed) return value;
        return { ...value, calendars,
          calendarEvents: value.calendarEvents.map(item => removedCalendarIds.has(item.calendarId) && !item.deletedAt
            ? { ...item, deletedAt: now, updatedAt: now, revision: item.revision + 1 } : item),
          eventTemplates: value.eventTemplates.map(item => removedCalendarIds.has(item.calendarId) && !item.deletedAt
            ? { ...item, deletedAt: now, updatedAt: now, revision: item.revision + 1 } : item)
        };
      });
    }).catch(() => { if (!cancelled) setIcsFeedStatus("Subscribed calendars could not be refreshed. Cached events remain available offline."); });
    return () => { cancelled = true; };
  }, [accountSyncAvailable, mutate]);
  const saveIcsSubscriptionCache = async (subscription: CachedIcsCalendar) => {
    const next = [...icsCalendarCache.filter(item => item.subscriptionId !== subscription.subscriptionId), subscription];
    await persistIcsCalendarCache(next);
    setIcsCalendarCache(next);
  };
  const subscribeIcsCalendar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!syncStatus.authenticated || syncStatus.state === "account_mismatch") { setIcsFeedStatus("Sign in with the account linked to this local profile before subscribing to a calendar."); return; }
    const calendar = createCalendar(icsFeedName, icsFeedColor);
    if (!calendar || !icsFeedUrl.trim()) { setIcsFeedStatus("Enter a calendar name and HTTPS feed URL."); return; }
    setIcsFeedBusy(true);
    setIcsFeedStatus("Adding calendar and securely checking its feed…");
    try {
      const response = await fetch("/api/v1/calendars/subscriptions", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId: calendar.id, name: calendar.name, color: calendar.color, visible: true, url: icsFeedUrl.trim() }) });
      const result = await response.json().catch(() => ({})) as { subscription?: CachedIcsCalendar; error?: string };
      if (!response.ok || !result.subscription) throw new Error(result.error === "invalid_subscription"
        ? "Use a public HTTPS calendar feed URL and a valid name/color." : "The calendar feed could not be added. Check the URL and try again.");
      const subscription = result.subscription;
      const color = normalizeCalendarColor(subscription.color) ?? calendar.color;
      mutate(value => ({ ...value, calendars: [...value.calendars, { ...calendar, name: subscription.name, color, visible: subscription.visible }] }));
      await saveIcsSubscriptionCache(subscription);
      setIcsSubscribeOpen(false);
      setIcsFeedUrl("");
      setIcsFeedName("");
      setIcsFeedStatus(subscription.lastError
        ? "Calendar added. Its first refresh failed; cached events will appear when the feed is reachable."
        : `Calendar added${subscription.events.length ? ` · ${subscription.events.length} events loaded` : ""}.`);
    } catch (cause) { setIcsFeedStatus(cause instanceof Error ? cause.message : "Calendar feed could not be added."); }
    finally { setIcsFeedBusy(false); }
  };
  const refreshIcsCalendar = async (subscription: CachedIcsCalendar) => {
    if (!accountSyncAvailable) { setIcsFeedStatus("Sign in and reconnect to refresh this calendar. Cached events remain available offline."); return false; }
    if (icsFeedBusy) return false;
    setIcsFeedBusy(true);
    setIcsFeedStatus(`Refreshing ${subscription.name}…`);
    try {
      const response = await fetch(`/api/v1/calendars/subscriptions/${subscription.subscriptionId}/refresh`, {
        method: "POST", credentials: "same-origin", cache: "no-store" });
      const result = await response.json().catch(() => ({})) as { subscription?: CachedIcsCalendar; error?: string };
      if (!response.ok || !result.subscription) throw new Error(result.error === "refresh_throttled"
        ? "This calendar was refreshed recently. Try again in a few minutes." : "The calendar could not be refreshed; cached events are unchanged.");
      await saveIcsSubscriptionCache(result.subscription);
      setIcsFeedStatus(result.subscription.lastError
        ? `${subscription.name} could not be refreshed; showing its last cached events.`
        : `${subscription.name} refreshed · ${result.subscription.events.length} events.`);
      return true;
    } catch (cause) { setIcsFeedStatus(cause instanceof Error ? cause.message : "The calendar could not be refreshed."); return false; }
    finally { setIcsFeedBusy(false); }
  };
  const updateIcsCalendar = async (calendarId: string, patch: { name?: string; color?: CalendarColor; visible?: boolean }) => {
    const subscription = icsCalendarCache.find(item => item.calendarId === calendarId);
    if (!subscription || icsFeedBusy) return false;
    if (!accountSyncAvailable) {
      if (patch.visible === undefined || Object.keys(patch).length !== 1) {
        setIcsFeedStatus("Sign in and reconnect to change this subscribed calendar's settings.");
        return false;
      }
      const updated = { ...subscription, visible: patch.visible };
      try {
        await saveIcsSubscriptionCache(updated);
        const stamp = new Date().toISOString();
        mutate(value => ({ ...value, calendars: value.calendars.map(calendar => calendar.id === calendarId
          ? { ...calendar, visible: patch.visible!, updatedAt: stamp, revision: calendar.revision + 1 } : calendar) }));
        setIcsFeedStatus("Visibility changed on this device; sign in while online to save it to your account.");
        return true;
      } catch { setIcsFeedStatus("Calendar visibility could not be saved on this device."); return false; }
    }
    setIcsFeedBusy(true);
    try {
      const response = await fetch(`/api/v1/calendars/subscriptions/${subscription.subscriptionId}`, {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch) });
      const result = await response.json().catch(() => ({})) as { subscription?: CachedIcsCalendar };
      if (!response.ok || !result.subscription) throw new Error("Calendar settings could not be saved.");
      const updated = result.subscription;
      await saveIcsSubscriptionCache(updated);
      const color = normalizeCalendarColor(updated.color);
      if (!color) throw new Error("Calendar settings returned an invalid color.");
      mutate(value => ({ ...value, calendars: value.calendars.map(calendar => calendar.id === calendarId ? {
        ...calendar, name: updated.name, color, visible: updated.visible,
        updatedAt: new Date().toISOString(), revision: calendar.revision + 1
      } : calendar) }));
      setIcsFeedStatus(`${updated.name} settings saved.`);
      return true;
    } catch (cause) { setIcsFeedStatus(cause instanceof Error ? cause.message : "Calendar settings could not be saved."); return false; }
    finally { setIcsFeedBusy(false); }
  };
  const unsubscribeIcsCalendar = async (subscription: CachedIcsCalendar) => {
    if (!accountSyncAvailable) { setIcsFeedStatus("Sign in and reconnect to unsubscribe from this calendar."); return false; }
    if (icsFeedBusy) return false;
    setIcsFeedBusy(true);
    try {
      const response = await fetch(`/api/v1/calendars/subscriptions/${subscription.subscriptionId}`, {
        method: "DELETE", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Calendar subscription could not be removed.");
      const next = icsCalendarCache.filter(item => item.subscriptionId !== subscription.subscriptionId);
      await persistIcsCalendarCache(next);
      setIcsCalendarCache(next);
      const stamp = new Date().toISOString();
      mutate(value => ({ ...value,
        calendars: value.calendars.map(calendar => calendar.id === subscription.calendarId
          ? { ...calendar, deletedAt: stamp, updatedAt: stamp, revision: calendar.revision + 1 } : calendar),
        calendarEvents: value.calendarEvents.map(item => item.calendarId === subscription.calendarId && !item.deletedAt
          ? { ...item, deletedAt: stamp, updatedAt: stamp, revision: item.revision + 1 } : item),
        eventTemplates: value.eventTemplates.map(item => item.calendarId === subscription.calendarId && !item.deletedAt
          ? { ...item, deletedAt: stamp, updatedAt: stamp, revision: item.revision + 1 } : item)
      }));
      setIcsFeedStatus(`${subscription.name} was unsubscribed.`);
      return true;
    } catch (cause) { setIcsFeedStatus(cause instanceof Error ? cause.message : "Calendar subscription could not be removed."); return false; }
    finally { setIcsFeedBusy(false); }
  };
  const resolveConflict = (conflict: SyncConflict, choice: "local" | "remote") => {
    const resolve = writes.current.catch(() => undefined).then(async () => {
      await resolveSyncConflict(conflict.key, choice);
      if (choice === "remote") {
        const latest = await readData();
        rememberDashboardAnchor();
        current.current = latest;
        setData(latest);
      }
      setSyncConflicts(items => items.filter(item => item.key !== conflict.key));
      void syncClient.current?.syncNow();
    });
    writes.current = resolve.catch(() => undefined);
  };
  const retireSyncDevice = async (device: SyncDevice) => {
    if (device.deviceId === getLocalSyncDeviceId()) { setDeviceStatus("This browser is the current sync device and cannot remove itself."); return; }
    if (!confirm(`Remove ${device.displayName} from this account? That install will need to sign in and register again.`)) return;
    try {
      const response = await fetch(`/api/v1/devices/${device.deviceId}`, { method: "DELETE", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Device could not be removed.");
      setSyncDevices(items => items.map(item => item.deviceId === device.deviceId ? { ...item, retiredAt: new Date().toISOString() } : item));
      setDeviceStatus("Device removed from this account.");
    } catch (cause) { setDeviceStatus(cause instanceof Error ? cause.message : "Device could not be removed."); }
  };
  const refreshAttachments = async () => {
    try {
      const response = await fetch("/api/v1/attachments", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in to manage attachments." : "Attachments are unavailable right now.");
      const result = await response.json() as { attachments?: AttachmentRecord[] };
      setAttachments(Array.isArray(result.attachments) ? result.attachments : []);
      setAttachmentStatus("");
    } catch (cause) { setAttachmentStatus(cause instanceof Error ? cause.message : "Attachments are unavailable right now."); }
  };
  const uploadAttachment = async (file: File) => {
    if (!attachmentTaskId) { setAttachmentStatus("Choose a task before uploading a file."); return; }
    try {
      await queueAttachmentUpload({ taskId: attachmentTaskId, fileName: file.name, mediaType: file.type, blob: file });
      setPendingAttachments(await readPendingAttachmentUploads());
      setAttachmentStatus("Attachment saved on this device. It will upload when a connection and sign-in are available.");
      if (navigator.onLine) {
        const result = await syncPendingAttachmentUploads();
        setPendingAttachments(await readPendingAttachmentUploads());
        if (result.uploaded) { setAttachmentStatus("Attachment uploaded."); await refreshAttachments(); }
        else if (result.blocked === "service") setAttachmentStatus("Attachment is saved locally; the service will be retried later.");
      }
    } catch (cause) { setAttachmentStatus(cause instanceof Error ? cause.message : "The attachment could not be uploaded."); }
  };
  const downloadAttachment = async (attachment: AttachmentRecord) => {
    try {
      const response = await fetch(`/api/v1/attachments/${attachment.id}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("The attachment could not be downloaded.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = attachment.fileName; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setAttachmentStatus(cause instanceof Error ? cause.message : "The attachment could not be downloaded."); }
  };
  const deleteAttachment = async (attachment: AttachmentRecord) => {
    if (!confirm(`Delete ${attachment.fileName}?`)) return;
    try {
      const response = await fetch(`/api/v1/attachments/${attachment.id}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("The attachment could not be deleted.");
      setAttachments(items => items.filter(item => item.id !== attachment.id));
      setAttachmentStatus("Attachment deleted.");
    } catch (cause) { setAttachmentStatus(cause instanceof Error ? cause.message : "The attachment could not be deleted."); }
  };
  useEffect(() => {
    if (ready) mutate(value => pruneExpiredHistory(value, today));
  }, [ready, today, mutate]);
  const toggle = (task: Task) => mutate(value => {
    if (!task.completedAt) return completeTask(value, task.id);
    const completion = value.completions.filter(item => item.taskId === task.id).at(-1);
    return completion ? undoCompletion(value, completion.id) : { ...value, tasks: value.tasks.map(item => item.id === task.id ? {
      ...item, completedAt: undefined, updatedAt: new Date().toISOString(), revision: item.revision + 1
    } : item) };
  });
  const projects = data.projects.filter(p => !p.deletedAt && !p.archivedAt).sort((a, b) => a.sortKey - b.sortKey || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const tags = data.tags.filter(t => !t.deletedAt);
  const taskRow = (task: Task, caption?: string, completionId?: string, key = task.id, scheduleDate = task.dueDate && task.dueDate >= today ? task.dueDate : today) => {
    const isComplete = Boolean(completionId || task.completedAt);
    const latestCompletion = completionId && data.completions.filter(item => item.taskId === task.id).at(-1)?.id === completionId;
    return <div className={`taskRow priority-${task.priority} ${isComplete ? "completed" : ""}`} key={key}>
      <button className="complete" disabled={completionId ? !latestCompletion : false} onClick={() => completionId ? latestCompletion && mutate(value => undoCompletion(value, completionId)) : toggle(task)} aria-label={isComplete ? `Reopen ${task.title}` : `Complete ${task.title}`}>{isComplete ? "✓" : "○"}</button>
      <button className="taskText" draggable={!isComplete} onDragStart={e => { if (isComplete) return; e.dataTransfer.setData("application/x-ltm-task", task.id); e.dataTransfer.effectAllowed = "copy"; }} onClick={() => setEditing(task.id)}><span>{task.title}</span><small>{completionId ? `Completed ${caption ?? ""}` : caption ?? [task.dueDate && `Due ${dateLabel(task.dueDate)}`, projects.find(p => p.id === task.projectId)?.name, task.priority !== "low" && `${priorityLabel(task.priority)} priority`].filter(Boolean).join(" · ")}</small></button>
      {!isComplete && <button className="scheduleAction" onClick={() => setScheduleEditing({ taskId: task.id, date: scheduleDate })} aria-label={`Schedule work for ${task.title}`} title="Schedule work">◷</button>}
      <button className="more" onClick={() => setEditing(task.id)} aria-label={`Edit ${task.title}`}>···</button>
    </div>;
  };
  const overdue = overdueTasks(data, today);
  const searchedTasks = filterTasks(data, { query, today });
  const taskTabTasks = [...searchedTasks].sort(taskDueDateOrder);
  const kanbanGroups = [
    { key: "open", label: "Open", tasks: taskTabTasks.filter(task => !task.completedAt) },
    { key: "completed", label: "Completed", tasks: taskTabTasks.filter(task => Boolean(task.completedAt)) }
  ];
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
  const externalEvents = icsCalendarCache.filter(subscription => subscription && Array.isArray(subscription.events)).flatMap(subscription => subscription.events.flatMap(event => {
    const item = toReadOnlyCalendarEvent(subscription, event);
    return item ? [item] : [];
  }));
  const externalEventIds = new Set(externalEvents.map(event => event.id));
  const calendarViewData: Data = externalEvents.length ? { ...data, calendarEvents: [...data.calendarEvents, ...externalEvents] } : data;
  const calendarEvents = calendarEventsForDay(calendarViewData, calendarSelectedDate);
  const monthEventsByDay = new Map<string, ReturnType<typeof calendarEventsForDay>>();
  for (const item of calendarEventOccurrences(calendarViewData, calendarGridStart, addDays(calendarGridStart, 42))) {
    const end = item.allDay ? item.endDate! : addDays(item.occurrenceDate, 1);
    for (let day = item.occurrenceDate; day < end; day = addDays(day, 1)) {
      monthEventsByDay.set(day, [...(monthEventsByDay.get(day) ?? []), item]);
    }
  }
  const timelineItems: CalendarTimelineItem[] = [
    ...calendarEvents.flatMap(item => {
      if (item.allDay || item.event.allDay || !item.startInstant || !item.endInstant) return [];
      const event = item.event;
      const color = activeCalendars.find(calendar => calendar.id === event.calendarId)?.color ?? defaultCalendarColor;
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
  const otherDashboardTasks = filterTasks(data, { today, dateScope: "undated" });
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
        <header className="pageHeader"><div><span className="eyebrow">YOUR SPACE</span><h2>{projectId && view === "Projects" ? projects.find(p => p.id === projectId)?.name : view}</h2><p>{view === "Dashboard" ? "A little clarity, one day at a time." : view === "Calendar" ? "Events, due dates, and planned work." : ""}</p></div><div className="pageHeaderActions"><button type="button" className="outlineOpen" disabled={Boolean(error)} onClick={() => setOutlineImportOpen(true)}>Import outline</button></div></header>
        {view === "Dashboard" && <><div className="streamControls"><button onClick={goToday}>Return to Today</button></div>
          {overdue.length > 0 && <section className="stream overduePanel" aria-label="Overdue tasks"><div className="group overdue"><h4>OVERDUE</h4>{overdue.map(task => taskRow(task, overdueDueCaption(task.dueDate!, today), undefined, task.id, today))}</div></section>}
          {otherDashboardTasks.length > 0 && <section className="stream otherTasksPanel" aria-label="Other tasks" style={{ flex: "0 0 auto", minHeight: 88, maxHeight: "min(35vh, 280px)", overflowY: "auto" }}><div className="group"><h4>OTHER TASKS <span>{otherDashboardTasks.length}</span></h4><p className="hint">Tasks without a due date.</p>{otherDashboardTasks.map(task => taskRow(task, task.completedAt ? new Date(task.completedAt).toLocaleDateString() : "No date assigned"))}</div></section>}
          <div className="stream dayScroller" ref={dayScrollRef} onScroll={handleDayScroll} role="region" aria-label="Days">
            {visibleDayStart > earliestDay && <button className="loadMore" onClick={() => shiftDays(-1)}>Earlier days ↑</button>}
            {dashboard.map(day => {
            const past = day.date < today;
            const empty = !day.scheduled.length && !day.due.length && !day.completed.length;
            const label = day.date === today ? "TODAY" : day.date === addDays(today, 1) ? "TOMORROW" : dateLabel(day.date);
            return <article className={`day ${past ? "dayPast" : ""} ${empty ? "emptyDaySection" : ""}`} data-day={day.date} key={day.date} ref={day.date === today ? todayRef : undefined}>
            <div className="dayHeader"><h3 aria-label={`${label} ${day.date}`}>{label}</h3><time dateTime={day.date}>{day.date}</time></div>
            {!!day.scheduled.length && <div className="group"><h4>SCHEDULED</h4>{day.scheduled.map(({ block, task, completionId }) => taskRow(task, `${timeLabel(block.startInstant)} – ${timeLabel(block.endInstant)} · Work block${task.dueDate === day.date ? " · Also due today" : ""}`, completionId, `block:${block.id}`, day.date))}</div>}
            {!!day.due.length && <div className="group"><h4>DUE</h4>{day.due.map(task => taskRow(task, task.dueTime ? `Due ${dueTimeCaption(task.dueTime)}` : "", undefined, task.id, day.date))}</div>}
            {!!day.completed.length && <div className="group"><h4>COMPLETED</h4>{day.completed.map(item => taskRow(item.task, new Date(item.completedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), item.completionId || undefined, `completion:${item.completionId || item.task.id}:${item.completedAt}`))}</div>}
            {empty ? <div className={`emptyDay ${past ? "pastEmpty" : ""}`}><span>{past ? "No completed items" : "Nothing planned"}</span><button onClick={() => setEditing(`new:${day.date}`)}>+ Add</button></div> :
              <button className="dayAdd" onClick={() => setEditing(`new:${day.date}`)}>+ Add task for this day</button>}
          </article>})}
            <button className="loadMore" onClick={() => shiftDays(1)}>Later days ↓</button>
          </div>
        </>}
        {view === "Calendar" && <section className="calendarCard" aria-label="Calendar">
          <div className="calendarToolbar">
            <div className="calendarMonthControl"><button type="button" aria-label="Previous month" onClick={() => shiftCalendarMonth(-1)}>‹</button><h3>{calendarMonthLabel}</h3><button type="button" aria-label="Next month" onClick={() => shiftCalendarMonth(1)}>›</button></div>
            <div className="calendarActions"><button type="button" className="calendarToday" onClick={goCalendarToday}>Today</button><button type="button" className="calendarToday" onClick={() => setEventEditing({ date: calendarSelectedDate })}>+ Event</button></div>
          </div>
          {scheduleUndo && <div className="scheduleUndo" role="status"><span>Planning change saved.</span><button type="button" onClick={() => { const blocks = scheduleUndo; mutate(value => ({ ...value, blocks })); setScheduleUndo(null); }}>Undo</button></div>}
          <div className="calendarManagement">
            <div className="calendarToggles" aria-label="Visible calendars">
              {activeCalendars.map(calendar => {
                const subscription = icsCalendarCache.find(item => item.calendarId === calendar.id);
                return <div className="calendarToggle" key={calendar.id}>
                  <label><input type="checkbox" checked={subscription?.visible ?? calendar.visible} disabled={Boolean(subscription && icsFeedBusy)} onChange={event => {
                    if (subscription) void updateIcsCalendar(calendar.id, { visible: event.target.checked });
                    else mutate(value => ({ ...value, calendars: value.calendars.map(item => item.id === calendar.id ? { ...item, visible: event.target.checked, updatedAt: new Date().toISOString(), revision: item.revision + 1 } : item) }));
                  }} /><span className="calendarColor" style={{ backgroundColor: calendar.color }} />{calendar.name}{subscription && <small> · read-only feed</small>}</label>
                  <div className="calendarEditActions"><button type="button" className="calendarEditButton" aria-label={`Edit ${calendar.name} calendar`} disabled={Boolean(subscription && !accountSyncAvailable)} onClick={() => { setCalendarName(calendar.name); setCalendarColor(calendar.color); setCalendarEditingId(calendar.id); setCalendarCreating(true); }}>Edit</button>
                    {subscription && <button type="button" disabled={icsFeedBusy || !accountSyncAvailable} onClick={() => { void refreshIcsCalendar(subscription); }}>Refresh</button>}
                  </div>
                </div>;
              })}
            </div>
            <div className="calendarManagementActions"><button type="button" onClick={() => { setCalendarEditingId(null); setCalendarName(""); setCalendarColor(defaultCalendarColor); setCalendarCreating(true); }}>+ Calendar</button><button type="button" disabled={icsFeedBusy} onClick={() => {
              if (!accountSyncAvailable) { setIcsFeedStatus("Sign in from Settings before subscribing to an external calendar."); return; }
              setIcsSubscribeOpen(value => !value);
            }}>+ Subscribe</button></div>
          </div>
          {icsSubscribeOpen && <form className="calendarCreateForm" aria-label="Subscribe to calendar" onSubmit={subscribeIcsCalendar}>
            <label>Calendar name<input value={icsFeedName} onChange={event => setIcsFeedName(event.target.value)} maxLength={100} required placeholder="e.g. Family calendar" /></label>
            <label>HTTPS calendar feed URL<input type="url" value={icsFeedUrl} onChange={event => setIcsFeedUrl(event.target.value)} maxLength={2048} autoComplete="off" spellCheck={false} required placeholder="https://…" /></label>
            <p>Only public HTTPS feeds are accepted. The source URL is encrypted at rest; imported events are read-only and cached on this device.</p>
            <fieldset className="calendarColorField"><legend>Color</legend><CalendarColorPicker value={icsFeedColor} onChange={setIcsFeedColor} /></fieldset>
            <div className="calendarCreateActions"><button type="button" onClick={() => setIcsSubscribeOpen(false)}>Cancel</button><button className="add" disabled={icsFeedBusy || !accountSyncAvailable || !icsFeedName.trim() || !icsFeedUrl.trim()}>{icsFeedBusy ? "Checking feed…" : "Subscribe"}</button></div>
          </form>}
          {icsCalendarCache.map(subscription => <div className="tagLine" key={subscription.subscriptionId}><span><strong>{subscription.name}</strong><small> · {subscription.lastRefreshAt ? `Updated ${new Date(subscription.lastRefreshAt).toLocaleString()}` : "Waiting for first refresh"}{subscription.lastError ? " · refresh failed; showing cached events" : ` · ${subscription.events.length} events cached`}</small></span><button type="button" disabled={icsFeedBusy || !accountSyncAvailable} onClick={() => { void refreshIcsCalendar(subscription); }}>Refresh feed</button><button type="button" className="danger" disabled={icsFeedBusy || !accountSyncAvailable} onClick={() => { if (confirm(`Unsubscribe from ${subscription.name}? Its imported events will disappear from this device.`)) void unsubscribeIcsCalendar(subscription); }}>Unsubscribe</button></div>)}
          {icsFeedStatus && <p role="status" aria-live="polite">{icsFeedStatus}</p>}
          {calendarCreating && <form className="calendarCreateForm" aria-label={calendarEditingId ? "Edit calendar" : "Create calendar"} onSubmit={event => { event.preventDefault(); if (calendarEditingId) {
            const subscription = icsCalendarCache.find(item => item.calendarId === calendarEditingId);
            if (subscription) { void updateIcsCalendar(calendarEditingId, { name: calendarName, color: calendarColor }).then(saved => { if (saved) { setCalendarCreating(false); setCalendarEditingId(null); setCalendarName(""); } }); return; }
            mutate(value => updateCalendar(value, calendarEditingId, calendarName, calendarColor));
          } else { const calendar = createCalendar(calendarName, calendarColor); if (!calendar) return; mutate(value => ({ ...value, calendars: [...value.calendars, calendar] })); }
            setCalendarCreating(false); setCalendarEditingId(null); setCalendarName(""); }}>
            <label>Calendar name<input aria-label="Calendar name" value={calendarName} onChange={event => setCalendarName(event.target.value)} maxLength={60} required placeholder="e.g. School" /></label>
            <fieldset className="calendarColorField"><legend>Color</legend><CalendarColorPicker value={calendarColor} onChange={setCalendarColor} /></fieldset>
            <div className="calendarCreateActions">{calendarEditingId && calendarEditingId !== "00000000-0000-4000-8000-000000000001" && <button type="button" className="danger" onClick={() => setCalendarDeleteConfirm(calendarEditingId)}>{icsCalendarCache.some(item => item.calendarId === calendarEditingId) ? "Unsubscribe" : "Delete"}</button>}<button type="button" onClick={() => { setCalendarCreating(false); setCalendarEditingId(null); }}>Cancel</button><button className="add" disabled={icsFeedBusy || !calendarName.trim()}>{calendarEditingId ? "Save changes" : "Create calendar"}</button></div>
          </form>}
          {calendarDeleteConfirm && <div className="modalBackdrop" style={{ zIndex: 20 }} onMouseDown={event => { if (event.target === event.currentTarget) setCalendarDeleteConfirm(null); }}><section className="editor" role="alertdialog" aria-modal="true" aria-labelledby="delete-calendar-title"><h2 id="delete-calendar-title">{icsCalendarCache.some(item => item.calendarId === calendarDeleteConfirm) ? "Unsubscribe from calendar?" : "Delete calendar?"}</h2><p>{icsCalendarCache.some(item => item.calendarId === calendarDeleteConfirm) ? "This removes the subscribed feed and its cached events from this device. Events from the source are read-only." : `This will remove “${data.calendars.find(calendar => calendar.id === calendarDeleteConfirm)?.name}”, including its events and event templates. This cannot be undone.`}</p><div className="editorActions"><button type="button" onClick={() => setCalendarDeleteConfirm(null)}>Cancel</button><button type="button" className="danger" disabled={icsFeedBusy} onClick={() => { const id = calendarDeleteConfirm; const subscription = icsCalendarCache.find(item => item.calendarId === id); if (subscription) { void unsubscribeIcsCalendar(subscription).then(removed => { if (removed) { setCalendarDeleteConfirm(null); setCalendarCreating(false); setCalendarEditingId(null); } }); return; } const stamp = new Date().toISOString(); mutate(value => ({ ...value, calendars: value.calendars.map(calendar => calendar.id === id ? { ...calendar, deletedAt: stamp, updatedAt: stamp, revision: calendar.revision + 1 } : calendar), calendarEvents: value.calendarEvents.map(item => item.calendarId === id && !item.deletedAt ? { ...item, deletedAt: stamp, updatedAt: stamp, revision: item.revision + 1 } : item), eventTemplates: value.eventTemplates.map(item => item.calendarId === id && !item.deletedAt ? { ...item, deletedAt: stamp, updatedAt: stamp, revision: item.revision + 1 } : item) })); setCalendarDeleteConfirm(null); setCalendarCreating(false); setCalendarEditingId(null); }}>{icsCalendarCache.some(item => item.calendarId === calendarDeleteConfirm) ? "Unsubscribe" : "Delete"}</button></div></section></div>}
          <div className="calendarLayout">
            <div>
              <div className="calendarWeekdays" aria-hidden="true">{calendarWeekdays.map(day => <span key={day}>{day}</span>)}</div>
              <div className="calendarGrid" role="group" aria-label={`Dates in ${calendarMonthLabel}`}>
                {calendarDays.map(day => {
                  const taskDay = calendarDays.find(item => item.date === day.date);
                  const dayEvents = monthEventsByDay.get(day.date) ?? [];
                  const eventCount = dayEvents.length;
                  const itemCount = (taskDay?.scheduled.length ?? 0) + (taskDay?.due.length ?? 0) + (taskDay?.completed.length ?? 0) + eventCount;
                  const previews = [
                    ...dayEvents.map(item => ({ id: `event:${item.event.id}:${item.occurrenceDate}`, title: item.event.title,
                      color: activeCalendars.find(calendar => calendar.id === item.event.calendarId)?.color ?? defaultCalendarColor })),
                    ...(taskDay?.scheduled ?? []).map(item => ({ id: `block:${item.block.id}`, title: item.task.title, color: "blue" })),
                    ...(taskDay?.due ?? []).map(task => ({ id: `due:${task.id}`, title: task.title, color: "orange" }))
                  ].slice(0, 2);
                  return <button key={day.date} type="button" className={"calendarDay" + (day.date.slice(0, 7) !== calendarMonth ? " calendarDayOutsideMonth" : "") + (day.date === calendarSelectedDate ? " calendarDaySelected" : "") + (day.date === today ? " calendarDayToday" : "")}
                    aria-label={dateLabel(day.date) + (itemCount ? `, ${itemCount} calendar item${itemCount === 1 ? "" : "s"}` : ", no calendar items")}
                    aria-current={day.date === today ? "date" : undefined} aria-pressed={day.date === calendarSelectedDate}
                    onClick={() => { setCalendarSelectedDate(day.date); if (day.date.slice(0, 7) !== calendarMonth) setCalendarMonth(day.date.slice(0, 7)); }}
                    onDragOver={e => { if (e.dataTransfer.types.includes("application/x-ltm-task")) e.preventDefault(); }}
                    onDrop={e => { e.preventDefault(); const taskId = e.dataTransfer.getData("application/x-ltm-task"); if (!taskId || !data.tasks.some(task => task.id === taskId && !task.completedAt && !task.deletedAt)) return; setCalendarSelectedDate(day.date); setScheduleEditing({ taskId, date: day.date }); }}>
                    <span>{parseLocalDate(day.date).getDate()}</span>
                    <div className="calendarDayPreviews" aria-hidden="true">{previews.map(item => <span key={item.id} className="calendarDayPreview"><i className="calendarColor" style={{ backgroundColor: item.color }} />{item.title}</span>)}</div>
                    {itemCount > previews.length && <small aria-hidden="true">+{itemCount - previews.length} more</small>}
                  </button>;
                })}
              </div>
            </div>
            <div className="calendarAgenda" aria-live="polite">
              <div className="calendarAgendaHeader"><div><span className="eyebrow">SELECTED DAY</span><h3>{dateLabel(calendarSelectedDate)}</h3></div></div>
              <h4 className="calendarTimelineHeading">TIMELINE {calendarSelectedDate === today && <span>Now · {timeLabel(calendarNow.toISOString())}</span>}</h4>
              <CalendarTimeline day={calendarSelectedDate} items={timelineItems} now={calendarNow} />
              {!!calendarAgenda.scheduled.length && <div className="group"><h4>PLANNED WORK</h4>{calendarAgenda.scheduled.map(({ block, task, completionId }) => <div className="plannedRow" key={`calendar-block:${block.id}`}>{taskRow(task, `${timeLabel(block.startInstant)} – ${timeLabel(block.endInstant)} · Work block${task.dueDate === calendarSelectedDate ? " · Also due today" : ""}`, completionId, `calendar-block-task:${block.id}`, calendarSelectedDate)}<button type="button" className="scheduleAction" aria-label={`Edit scheduled block for ${task.title}`} onClick={() => setScheduleEditing({ taskId: task.id, blockId: block.id, date: calendarSelectedDate })}>Edit time</button><button type="button" className="scheduleAction" aria-label={`Unschedule ${task.title}`} onClick={() => { setScheduleUndo(data.blocks); mutate(value => deleteScheduledBlock(value, block.id)); }}>Remove</button></div>)}</div>}
              {!!calendarAgenda.due.length && <div className="group"><h4>DUE</h4>{calendarAgenda.due.map(task => taskRow(task, task.dueTime ? `Due ${dueTimeCaption(task.dueTime)}` : "", undefined, task.id, calendarSelectedDate))}</div>}
              {!!calendarAgenda.completed.length && <div className="group"><h4>COMPLETED</h4>{calendarAgenda.completed.map(item => taskRow(item.task, new Date(item.completedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }), item.completionId || undefined, `calendar-completion:${item.completionId || item.task.id}:${item.completedAt}`))}</div>}
              {!!calendarEvents.length && <div className="group"><h4>EVENTS</h4>{calendarEvents.map(item => {
                const calendar = activeCalendars.find(candidate => candidate.id === item.event.calendarId);
                const label = <><strong>{item.event.title}</strong><small>{item.allDay ? "All day" : `${timeLabel(item.startInstant!)} – ${timeLabel(item.endInstant!)}`} · {calendar?.name ?? "Calendar"}{externalEventIds.has(item.event.id) ? " · Read only" : ""}</small></>;
                return <div className="eventRow" key={`${item.event.id}:${item.occurrenceDate}`}><span className="calendarColor" style={{ backgroundColor: calendar?.color ?? defaultCalendarColor }} />{externalEventIds.has(item.event.id)
                  ? <div className="eventTitle" aria-label={`${item.event.title}, read-only subscribed event`}>{label}</div>
                  : <button type="button" className="eventTitle" onClick={() => setEventEditing({ id: item.event.id, date: item.occurrenceDate })}>{label}</button>}</div>;
              })}</div>}
              {!calendarAgenda.scheduled.length && !calendarAgenda.due.length && !calendarAgenda.completed.length && !calendarEvents.length && <p className="calendarEmpty">Nothing planned for this day.</p>}
            </div>
          </div>
        </section>}
        {view === "Tasks" && <>
          <div className="filters"><input aria-label="Search tasks" placeholder="Search titles and notes…" value={query} onChange={e => setQuery(e.target.value)} /></div>
          <p className="filterSummary" aria-live="polite">{searchedTasks.length} {searchedTasks.length === 1 ? "task" : "tasks"}</p>
          <div className="kanbanBoard" aria-label="Tasks grouped by status">{kanbanGroups.map(group => <section className="kanbanColumn" key={group.key} aria-label={`${group.label}, ${group.tasks.length} tasks`}><h3>{group.label}<small>{group.tasks.length}</small></h3>{group.tasks.map(task => <article className="kanbanCard" key={task.id}>{taskRow(task)}</article>)}{!group.tasks.length && <p className="empty">No {group.label.toLocaleLowerCase()} tasks.</p>}</section>)}</div>
        </>}
        {view === "Projects" && <><form className="quickAdd" onSubmit={e => { e.preventDefault(); const input = e.currentTarget.elements.namedItem("project") as HTMLInputElement; if (!input.value.trim()) return; mutate(value => ({ ...value, projects: [...value.projects, { ...newEntity(), name: input.value.trim(), color: "#c86b24", sortKey: Date.now() }] })); input.value = ""; }}><input name="project" aria-label="New project name" placeholder="New project name…" /><button>Create project</button></form>
          {!projectId ? <div className="projectGrid">{projects.map(p => <div className="projectCard" key={p.id}><button className="projectOpen" onClick={() => setProjectId(p.id)}><span className="projectDot" style={{ background: p.color }} /><strong>{p.name}</strong><small>{data.tasks.filter(t => t.projectId === p.id && !t.deletedAt && !t.completedAt).length} open tasks →</small></button><div className="orderControls"><button aria-label={`Move project ${p.name} up`} onClick={() => mutate(value => reorderProject(value, p.id, -1))}>↑</button><button aria-label={`Move project ${p.name} down`} onClick={() => mutate(value => reorderProject(value, p.id, 1))}>↓</button></div></div>)}</div> : <>
            <button className="linkButton" onClick={() => setProjectId("")}>← All projects</button>
            {[undefined, ...data.sections.filter(s => s.projectId === projectId && !s.deletedAt).sort((a, b) => a.sortKey - b.sortKey)].map(section => <div className="projectGroup" key={section?.id ?? "root"}>
              <div className="projectGroupHead"><h3>{section?.name ?? "Project tasks"}</h3>{section && <div className="orderControls"><button aria-label={`Move section ${section.name} up`} onClick={() => mutate(value => reorderSection(value, section.id, -1))}>↑</button><button aria-label={`Move section ${section.name} down`} onClick={() => mutate(value => reorderSection(value, section.id, 1))}>↓</button><button type="button" className="danger" onClick={() => { if (confirm("Delete this section? Its tasks will move to the project root.")) mutate(value => deleteSection(value, section.id)); }}>Delete</button></div>}</div>
              <div className="listPanel">{filterTasks(data, { projectId, completed: false }).filter(t => t.sectionId === section?.id).map(t => <div className="orderedTask" key={t.id}>{taskRow(t)}<div><button aria-label={`Move ${t.title} up`} onClick={() => mutate(value => reorderTask(value, t.id, -1))}>↑</button><button aria-label={`Move ${t.title} down`} onClick={() => mutate(value => reorderTask(value, t.id, 1))}>↓</button></div></div>)}</div>
            </div>)}
            <form className="quickAdd" onSubmit={e => { e.preventDefault(); const input = e.currentTarget.elements.namedItem("section") as HTMLInputElement; if (!input.value.trim()) return; mutate(value => ({ ...value, sections: [...value.sections, { ...newEntity(), projectId, name: input.value.trim(), sortKey: Date.now() }] })); input.value = ""; }}><input name="section" aria-label="New section" placeholder="New section…" /><button>Add section</button></form>
            <button className="linkButton" onClick={() => { if (!confirm("Archive this project? Its tasks will leave active views until restored in Settings.")) return; mutate(value => { const stamp = new Date().toISOString(); return { ...value, projects: value.projects.map(p => p.id === projectId ? { ...p, archivedAt: stamp, updatedAt: stamp, revision: p.revision + 1 } : p) }; }); setProjectId(""); }}>Archive project</button>
          </>}
        </>}
        {view === "Settings" && <div className="settingsPanel"><h3>Account sync</h3><p>Local changes save on this device first. When signed in, encrypted-in-transit sync runs in the background across your web and Home Screen installs. Your data remains available offline.</p><div className={`accountStatus ${authSignInStatus === "signed_in" ? "accountStatusConnected" : authSignInStatus === "signed_out" ? "accountStatusSignedOut" : "accountStatusChecking"}`} role="status" aria-live="polite"><span className="accountStatusIcon" aria-hidden="true">{authSignInStatus === "signed_in" ? "✓" : authSignInStatus === "signed_out" ? "○" : "…"}</span><span><strong>{authSignInStatus === "signed_in" ? "Signed in" : authSignInStatus === "signed_out" ? "Not signed in" : authSignInStatus === "unavailable" ? "Sign-in status unavailable" : "Checking sign-in…"}</strong><small>{authSignInStatus === "signed_in" ? "Your account is connected on this device." : authSignInStatus === "signed_out" ? "Sign in to sync across devices." : authSignInStatus === "unavailable" ? "Unable to verify your account right now. Your local data remains available." : "Checking your account session."}</small></span></div><p role="status" aria-live="polite">{syncStatus.state === "idle" ? "Sync is up to date." : syncStatus.state === "checking" ? "Checking account…" : syncStatus.state === "syncing" ? "Syncing changes…" : syncStatus.state === "signed_out" ? "Local changes are saved on this device; sign in to sync across devices." : syncStatus.state === "account_mismatch" ? "This local profile is already linked to a different account. To protect your data, sync is paused; use a separate browser profile for another account." : syncStatus.state === "conflict" ? "Some changes need attention before they can sync." : syncStatus.state === "offline" ? "Offline. Local changes are saved and will retry when connected." : syncStatus.state === "device_retired" ? "This device needs to be re-registered before it can sync." : `Sync paused. ${syncStatus.failure ? describeSyncFailure(syncStatus.failure) + " " : ""}Local data remains on this device; retrying${syncStatus.retryAt ? ` at ${new Date(syncStatus.retryAt).toLocaleTimeString()}` : ""}.`}</p>{syncStatus.failure && <small role="status">Sync detail: {syncStatus.failure.step}{syncStatus.failure.status ? ` · HTTP ${syncStatus.failure.status}` : ""}{syncStatus.failure.code ? ` · ${syncStatus.failure.code}` : ""}</small>}<div className="settingsActions">{authSignInStatus === "signed_in" ? <button type="button" onClick={() => { void fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" }).then(response => { if (response.ok) { setAuthSignInStatus("signed_out"); setSyncStatus({ state: "signed_out" }); } else setSyncStatus({ state: "error", authenticated: true }); }).catch(() => setSyncStatus({ state: "error", authenticated: true })); }}>Sign out</button> : <form action="/api/v1/auth/login" method="get"><input type="hidden" name="returnTo" value="/" /><button type="submit">Sign in</button></form>}<button type="button" onClick={() => { void syncClient.current?.syncNow(); }}>Sync now</button>{authSignInStatus === "signed_in" && <button type="button" onClick={() => { if (!confirm("Sign out every active LTM Todo session? You will need to sign in again on this device too.")) return; void fetch("/api/v1/auth/logout-all", { method: "POST", credentials: "same-origin" }).then(response => { if (response.ok) { setAuthSignInStatus("signed_out"); setSyncStatus({ state: "signed_out" }); setAuthSessions([]); setAuthSessionStatus("All LTM Todo sessions were revoked."); } else setAuthSessionStatus("Sessions could not be revoked. Please retry."); }).catch(() => setAuthSessionStatus("Sessions could not be revoked. Please retry.")); }}>Sign out all sessions</button>}</div>{syncConflicts.map(conflict => <div className="tagLine" key={conflict.key}><span><strong>{String(conflict.mutation.payload?.title ?? conflict.current?.payload?.title ?? conflict.mutation.entityType)}</strong><small> · changed on another device</small></span><div><button type="button" onClick={() => resolveConflict(conflict, "local")}>Keep this device</button><button type="button" onClick={() => resolveConflict(conflict, "remote")}>Use other device</button></div></div>)}
          <h3>Data storage</h3><p>Task and calendar changes save on this device first. When signed in, supported records also sync to your account through Cloudflare. To deliver reminders while the app is closed, reminder titles and scheduled times are sent to the separate Cloudflare reminder service. Each device has its own notification subscription.</p>
          <p>Backups include local tasks and calendars. They exclude attachment bytes, ICS feed URLs, and cached read-only feed events; download attachments separately. Feed URLs can grant access to a private calendar and are never exported unencrypted.</p>
          <div className="settingsActions">
            <button type="button" onClick={() => {
              try {
                const backup = createBackup(data);
                const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
                const link = document.createElement("a"); link.href = url; link.download = `ltm-todo-backup-${today}.json`; link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                setBackupStatus("Versioned backup downloaded.");
              } catch (cause) { setBackupStatus(cause instanceof Error ? cause.message : "Backup could not be created."); }
            }}>Download versioned backup</button>
            <label>Restore backup JSON<input type="file" accept="application/json,.json" onChange={event => {
              const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return;
              if (file.size > MAX_BACKUP_BYTES) { setBackupStatus("Backup file is larger than 16 MB."); return; }
              void file.text().then(text => {
                const restored = parseBackup(text);
                if (!confirm(`Restore ${restored.tasks.length} tasks and replace the current local data? This can be undone only with a backup.`)) return;
                mutate(currentData => ({ ...restored, generation: currentData.generation + 1 }));
                setBackupStatus("Backup validated. Local restore is being saved.");
              }).catch(cause => setBackupStatus(cause instanceof Error ? cause.message : "Backup could not be restored."));
            }} /></label>
          </div><p role="status" aria-live="polite">{backupStatus}</p>
          <h3>Protected attachments</h3><p>Attachments are private to your account and linked to one of your tasks. Supported types: JPEG, PNG, WebP, PDF, and plain text, up to 10 MiB. Offline uploads remain in this device&apos;s private IndexedDB queue and retry after reconnecting.</p><div className="settingsActions"><label>Attach to task<select aria-label="Attach to task" value={attachmentTaskId} onChange={event => setAttachmentTaskId(event.target.value)}><option value="">Choose a task</option>{data.tasks.filter(task => !task.deletedAt).map(task => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label><label>Upload file<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" disabled={!attachmentTaskId} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void uploadAttachment(file); }} /></label><button type="button" onClick={() => { void refreshAttachments(); }}>Refresh attachments</button></div>{pendingAttachments.map(attachment => <div className="tagLine" key={attachment.id}><span><strong>{attachment.fileName}</strong><small> · Saved on this device · {data.tasks.find(task => task.id === attachment.taskId)?.title ?? "Task"}</small></span></div>)}{attachments.map(attachment => <div className="tagLine" key={attachment.id}><span><strong>{attachment.fileName}</strong><small> · {Math.ceil(attachment.size / 1024).toLocaleString()} KiB · {data.tasks.find(task => task.id === attachment.taskId)?.title ?? "Task"}</small></span><div><button type="button" onClick={() => { void downloadAttachment(attachment); }}>Download</button><button type="button" className="danger" onClick={() => { void deleteAttachment(attachment); }}>Delete</button></div></div>)}<p role="status" aria-live="polite">{attachmentStatus}</p>
          <h3>Task templates</h3><p>Templates create fresh tasks with their own IDs and completion history.</p>{data.taskTemplates.filter(template => !template.deletedAt).map(template => <div className="tagLine" key={template.id}><span><strong>{template.name}</strong><small> · {template.title}</small></span><button type="button" onClick={() => mutate(value => instantiateTaskTemplate(value, template.id))}>Create task</button></div>)}{!data.taskTemplates.some(template => !template.deletedAt) && <p>No templates yet. Select tasks in Tasks and choose “Save selected as templates.”</p>}
          <h3>Event templates</h3><p>Start a new calendar event from a saved event pattern.</p>{data.eventTemplates.filter(template => !template.deletedAt).map(template => <div className="tagLine" key={template.id}><span><strong>{template.name}</strong><small> · {template.title}</small></span><button type="button" onClick={() => mutate(value => instantiateEventTemplate(value, template.id, calendarSelectedDate))}>Create event on {calendarSelectedDate}</button></div>)}{!data.eventTemplates.some(template => !template.deletedAt) && <p>No event templates yet. Save an existing event as a template in its editor.</p>}
          <h3>Routines</h3><p>A routine starts a recurring task from a template. Completing that task advances its next due date.</p><form className="routineForm" onSubmit={e => {
            e.preventDefault();
            const repeatRule = recurrenceForRepeat(routineRepeatSelection, routineWeekdays);
            if (!routineTemplateId || !repeatRule) return;
            const form = e.currentTarget;
            const name = (form.elements.namedItem("routineName") as HTMLInputElement).value.trim();
            if (!name) return;
            mutate(value => createRoutine(value, routineTemplateId, name, routineStartDate, repeatRule));
            (form.elements.namedItem("routineName") as HTMLInputElement).value = "";
          }}>
            <label>Routine name<input name="routineName" required placeholder="Weekly review" /></label>
            <label>Template<CustomSelect aria-label="Routine template" value={routineTemplateId} onChange={e => setRoutineTemplateId(e.target.value)}><option value="">Choose template…</option>{data.taskTemplates.filter(template => !template.deletedAt).map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</CustomSelect></label>
            <div className="fieldPair"><label>First due date<DateField value={routineStartDate} min={historyStart(today)} onChange={setRoutineStartDate} /></label><label>Repeat<CustomSelect value={routineRepeatSelection} onChange={e => { const selection = e.target.value as RepeatSelection; setRoutineRepeatSelection(selection); const presetDays = defaultWeekdaysForRepeat(selection); if (presetDays) setRoutineWeekdays(presetDays); }}>{repeatOptionsFor().filter(option => option.value).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</CustomSelect></label></div>
            {repeatUsesWeekdayPicker(routineRepeatSelection) && <fieldset><legend>Repeat on</legend>{calendarWeekdays.map((name, day) => <label className="checkLabel" key={name}><input type="checkbox" checked={routineWeekdays.includes(day)} onChange={e => setRoutineWeekdays(e.target.checked ? [...routineWeekdays, day] : routineWeekdays.filter(value => value !== day))} /> {name}</label>)}<p className="hint">If none are selected, repeat on the original weekday.</p></fieldset>}
            <button disabled={!routineTemplateId}>Create routine</button>
          </form>{data.routines.filter(routine => !routine.deletedAt).map(routine => <div className="tagLine" key={routine.id}><span>{routine.name} · {repeatLabelFor(routine.recurrence)}</span><button type="button" onClick={() => mutate(value => setRoutineEnabled(value, routine.id, !routine.enabled))}>{routine.enabled ? "Pause" : "Resume"}</button></div>)}
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
          <h3>Tags</h3><form className="quickAdd" onSubmit={e => { e.preventDefault(); const input = e.currentTarget.elements.namedItem("tag") as HTMLInputElement; if (!input.value.trim()) return; mutate(value => ({ ...value, tags: [...value.tags, { ...newEntity(), name: input.value.trim(), color: "#c86b24" }] })); input.value = ""; }}><input name="tag" aria-label="New tag name" placeholder="New tag name…" /><button>Add tag</button></form>{tags.map(t => <div className="tagLine" key={t.id}><span>#{t.name}</span><div><button onClick={() => { const name = prompt("Rename tag", t.name)?.trim(); if (name) mutate(value => ({ ...value, tags: value.tags.map(item => item.id === t.id ? { ...item, name, revision: item.revision + 1, updatedAt: new Date().toISOString() } : item) })); }}>Rename</button><button type="button" className="danger" onClick={() => { if (confirm(`Delete tag ${t.name}?`)) mutate(value => ({ ...value, tags: value.tags.map(item => item.id === t.id ? { ...item, deletedAt: new Date().toISOString(), revision: item.revision + 1 } : item), tasks: value.tasks.map(item => item.tagIds.includes(t.id) ? { ...item, tagIds: item.tagIds.filter(id => id !== t.id), revision: item.revision + 1 } : item) })); }}>Delete</button></div></div>)}
          <h3>Archived projects</h3>{data.projects.filter(p => p.archivedAt && !p.deletedAt).map(p => <div className="tagLine" key={p.id}><span>{p.name}</span><button onClick={() => mutate(value => { const stamp = new Date().toISOString(); return { ...value, projects: value.projects.map(item => item.id === p.id ? { ...item, archivedAt: undefined, updatedAt: stamp, revision: item.revision + 1 } : item) }; })}>Restore</button></div>)}
          <h3>Sessions</h3><p>Revoking a session immediately blocks that browser session from LTM Todo. It does not sign you out of the identity provider itself.</p>{authSessions.map(session => <div className="tagLine" key={session.sessionKey}><span><strong>{session.current ? "This browser" : "Signed-in session"}</strong><small> · Last used {new Date(session.lastSeenAt).toLocaleString()} · Expires {new Date(session.expiresAt).toLocaleString()}</small></span>{!session.current && <button type="button" className="danger" onClick={() => { void fetch(`/api/v1/auth/sessions/${session.sessionKey}`, { method: "POST", credentials: "same-origin" }).then(response => { if (!response.ok) throw new Error(); setAuthSessions(current => current.filter(item => item.sessionKey !== session.sessionKey)); setAuthSessionStatus("Session revoked."); }).catch(() => setAuthSessionStatus("Session could not be revoked. Please retry.")); }}>Revoke</button>}</div>)}<p role="status" aria-live="polite">{authSessionStatus}</p>
          {syncStatus.authenticated && <div className="settingsActions"><button type="button" className="danger" onClick={() => { if (prompt("This deletes account sync data and attachments. Type DELETE to continue.") !== "DELETE") return; void fetch("/api/v1/account/delete", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmation: "DELETE" }) }).then(async response => { const result = await response.json() as { attachmentCleanup?: string }; if (!response.ok) throw new Error(); setSyncStatus({ state: "signed_out" }); setAuthSessions([]); setAttachments([]); setAccountStatus(result.attachmentCleanup === "pending" ? "Account data was deleted. Private attachment bytes are queued for Cloudflare cleanup. Local offline data on this device remains." : "Account data was deleted. Local offline data on this device remains."); }).catch(() => setAccountStatus("Account deletion could not be completed. Please retry.")); }}>Delete account and synced data</button></div>}{accountStatus && <p role="status" aria-live="polite">{accountStatus}</p>}
          <h3>Sync devices</h3><p>Devices keep their last acknowledged sync position. Devices inactive for 180 days are automatically retired; you can explicitly re-register this browser without changing its local task data.</p>
          {syncStatus.authenticated && syncDevices.filter(device => !device.retiredAt).map(device => <div className="tagLine" key={device.deviceId}><span><strong>{device.displayName}</strong><small> · Last active {new Date(device.lastSeenAt).toLocaleString()}</small></span>{device.deviceId === currentSyncDeviceId ? <span>This device</span> : <button type="button" className="danger" onClick={() => { void retireSyncDevice(device); }}>Remove</button>}</div>)}
          <p role="status" aria-live="polite">{deviceStatus}</p>
          {syncStatus.state === "device_retired" && <><p>This browser was removed from the account. You can register it again without changing local task data.</p><button type="button" onClick={() => { void syncClient.current?.reRegisterRetiredDevice(); }}>Register this browser again</button></>}
        </div>}
      </>}
      {ready && view !== "Settings" && <button type="button" className="dashboardAddFab" aria-label="Add a task or calendar event" aria-haspopup="dialog" onClick={() => {
        setDashboardComposerDate(view === "Calendar" ? calendarSelectedDate : view === "Dashboard" ? today : undefined);
        setDashboardComposerProject(view === "Projects" ? projectId || undefined : undefined);
        setDashboardComposerTab(view === "Calendar" ? "event" : "task");
        setDashboardComposerOpen(true);
      }}><svg className="addFabIcon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>}
    </section>
    {editing && <TaskEditor key={editing} task={data.tasks.find(t => t.id === editing)} initialDate={editing.startsWith("new:") ? editing.slice(4) : undefined} initialProject={view === "Projects" ? projectId : undefined} data={data} earliestDate={historyStart(today)} onClose={() => setEditing(null)} onSave={(task, reminderMinutes) => {
      mutate(value => saveTask(value, task, reminderMinutes)); setEditing(null);
    }} onDelete={id => { mutate(value => { const stamp = new Date().toISOString(); return { ...value,
      tasks: value.tasks.map(t => t.id === id ? { ...t, deletedAt: stamp, revision: t.revision + 1 } : t),
      blocks: value.blocks.map(b => b.taskId === id && !b.deletedAt ? { ...b, deletedAt: stamp, revision: b.revision + 1 } : b),
      reminders: value.reminders.map(r => r.taskId === id && !r.deletedAt ? { ...r, deletedAt: stamp, revision: r.revision + 1 } : r)
    }; }); setEditing(null); }} />}
    {outlineImportOpen && <OutlineImporter data={data} readOnlyCalendarIds={icsCalendarCache.map(calendar => calendar.calendarId)} onClose={() => setOutlineImportOpen(false)} onImport={async (items, destination) => {
      if (error || writeFailed.current) throw new Error("Resolve the storage error before importing.");
      const result = importOutlineItems(current.current, items, destination, today);
      mutate(() => result.data);
      await writes.current;
      if (writeFailed.current) throw new Error("Items could not be persisted. Download an unsaved backup from Settings before reloading.");
      return { added: result.added, skipped: result.skipped };
    }} />}
    {dashboardComposerOpen && <div className="modalBackdrop dashboardComposerBackdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDashboardComposerOpen(false); }}><section className="editor dashboardComposerModal" role="dialog" aria-modal="true" aria-labelledby="dashboard-composer-title" onKeyDown={event => { if (event.key === "Escape") setDashboardComposerOpen(false); }}>
      <div className="editorHead"><h2 id="dashboard-composer-title">Add to your day</h2><button type="button" onClick={() => setDashboardComposerOpen(false)} aria-label="Close add menu">×</button></div>
      <div className="dashboardComposerTabs" role="tablist" aria-label="Choose what to add">
        <button type="button" role="tab" aria-selected={dashboardComposerTab === "task"} aria-controls="dashboard-composer-panel" onClick={() => setDashboardComposerTab("task")}>Task</button>
        <button type="button" role="tab" aria-selected={dashboardComposerTab === "event"} aria-controls="dashboard-composer-panel" onClick={() => setDashboardComposerTab("event")}>Calendar</button>
      </div>
      <div id="dashboard-composer-panel" role="tabpanel" aria-label={dashboardComposerTab === "task" ? "Add task" : "Add calendar event"}>
        {dashboardComposerTab === "task" ? <TaskEditor key="dashboard-task" embedded initialDate={dashboardComposerDate} initialProject={dashboardComposerProject} data={data} earliestDate={historyStart(today)} onClose={() => setDashboardComposerOpen(false)} onSave={(task, reminderMinutes) => { mutate(value => saveTask(value, task, reminderMinutes)); setDashboardComposerOpen(false); }} onDelete={() => {}} />
          : <CalendarEventEditor key="dashboard-event" embedded date={dashboardComposerDate ?? today} calendars={activeCalendars} onClose={() => setDashboardComposerOpen(false)} onSave={event => { mutate(value => saveCalendarEvent(value, event)); setDashboardComposerOpen(false); }} onSaveTemplate={(event, name) => mutate(value => saveEventTemplate(value, event, name))} onDelete={() => {}} />}
      </div>
    </section></div>}
    {eventEditing && <CalendarEventEditor key={`${eventEditing.id ?? "new"}:${eventEditing.date}`} event={data.calendarEvents.find(item => item.id === eventEditing.id)} date={eventEditing.date} calendars={activeCalendars} onClose={() => setEventEditing(null)} onSave={event => { mutate(value => saveCalendarEvent(value, event)); setEventEditing(null); }} onSaveTemplate={(event, name) => mutate(value => saveEventTemplate(value, event, name))} onDelete={id => { const stamp = new Date().toISOString(); mutate(value => ({ ...value, calendarEvents: value.calendarEvents.map(event => event.id === id ? { ...event, deletedAt: stamp, updatedAt: stamp, revision: event.revision + 1 } : event) })); setEventEditing(null); }} />}
    {scheduleEditing && <ScheduleEditor key={`${scheduleEditing.taskId}:${scheduleEditing.blockId ?? "new"}:${scheduleEditing.date}`} task={data.tasks.find(task => task.id === scheduleEditing.taskId)} block={data.blocks.find(item => item.id === scheduleEditing.blockId)} data={calendarViewData} initialDate={scheduleEditing.date} today={today} now={calendarNow} onClose={() => setScheduleEditing(null)} onSave={block => { setScheduleUndo(data.blocks); mutate(value => saveScheduledBlock(value, block)); setScheduleEditing(null); }} />}
  </main>;
}

function CalendarEventEditor({ event, date, calendars, onClose, onSave, onSaveTemplate, onDelete, embedded = false }: {
  event?: CalendarEvent; date: string; calendars: Data["calendars"]; onClose: () => void;
  onSave: (event: CalendarEvent) => void; onSaveTemplate: (event: CalendarEvent, name: string) => void; onDelete: (id: string) => void;
  embedded?: boolean;
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
  const [repeatSelection, setRepeatSelection] = useState<RepeatSelection>(() => repeatSelectionFor(event?.recurrence));
  const [weekdays, setWeekdays] = useState<number[]>(event?.recurrence?.weekdays ?? []);
  const [until, setUntil] = useState(event?.recurrence?.until ?? "");
  const [count, setCount] = useState(event?.recurrence?.count ? String(event.recurrence.count) : "");
  const startInstant = !allDay && startDate ? zonedDateTimeToInstant(startDate, startTime, timeZone) : undefined;
  const endInstant = !allDay && endDate ? zonedDateTimeToInstant(endDate, endTime, timeZone) : undefined;
  const invalid = !title.trim() || !calendarId || (allDay ? endDate < startDate : !startInstant || !endInstant || endInstant <= startInstant) ||
    (Boolean(repeatSelection && until) && until < startDate) || (Boolean(repeatSelection && count) && Number(count) < 1);
  const form = <form className={`editor${embedded ? " composerEditorEmbedded" : ""}`} onSubmit={e => {
    e.preventDefault(); if (invalid) return;
    const base = event ?? { ...newEntity(), calendarId, title, notes, recurrence: undefined };
    const repeatRule = recurrenceForRepeat(repeatSelection, weekdays);
    const common = { ...base, calendarId, title: title.trim(), notes, updatedAt: new Date().toISOString(), revision: event ? event.revision + 1 : 1,
      recurrence: repeatRule ? { ...repeatRule, until: until || undefined, count: count ? Number(count) : undefined } : undefined };
    onSave(allDay ? { ...common, allDay: true, startDate, endDate: addDays(endDate, 1) } : { ...common, allDay: false, startInstant: startInstant!, endInstant: endInstant!, timeZone });
  }}>
    {!embedded && <div className="editorHead"><h2>{event ? "Edit event" : "New event"}</h2><button type="button" onClick={onClose} aria-label="Close editor">×</button></div>}
    <label>Title<input required value={title} onChange={e => setTitle(e.target.value)} placeholder="What’s happening?" /></label>
    <label>Notes<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    <label>Calendar<CustomSelect value={calendarId} onChange={e => setCalendarId(e.target.value)}>{calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</CustomSelect></label>
    <label className="checkLabel"><input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} /> All day</label>
    <div className={`fieldPair${embedded ? " dateTimePair" : ""}`}><label>Starts<DateField value={startDate} onChange={setStartDate} /></label><label>Ends {allDay ? "(inclusive)" : ""}<DateField value={endDate} onChange={setEndDate} /></label></div>
    {!allDay && <><div className={`fieldPair${embedded ? " dateTimePair" : ""}`}><label>Start time<TimeField value={startTime} onChange={setStartTime} /></label><label>End time<TimeField value={endTime} onChange={setEndTime} /></label></div><p className="hint">Time zone: {timeZone}. Repeated events keep this local wall time across daylight saving changes.</p></>}
    <label>Repeat<CustomSelect value={repeatSelection} onChange={e => { const selection = e.target.value as RepeatSelection; setRepeatSelection(selection); const presetDays = defaultWeekdaysForRepeat(selection); if (presetDays) setWeekdays(presetDays); }}>{repeatOptionsFor(event?.recurrence).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</CustomSelect></label>
    {repeatUsesWeekdayPicker(repeatSelection) && <fieldset><legend>Repeat on</legend>{calendarWeekdays.map((name, day) => <label className="checkLabel" key={name}><input type="checkbox" checked={weekdays.includes(day)} onChange={e => setWeekdays(e.target.checked ? [...weekdays, day] : weekdays.filter(value => value !== day))} /> {name}</label>)}</fieldset>}
    {repeatSelection && <div className="fieldPair"><label>Repeat until<DateField value={until} min={startDate} onChange={setUntil} /></label><label>End after occurrences<input type="number" min="1" value={count} onChange={e => setCount(e.target.value)} placeholder="No limit" /></label></div>}
    <div className="editorActions">{event && <><button type="button" onClick={() => {
      if (invalid) return;
      const name = prompt("Template name", title.trim());
      if (!name?.trim()) return;
      const base = { ...(event ?? newEntity()), calendarId, title: title.trim(), notes: notes.trim(), recurrence: undefined };
      onSaveTemplate(allDay ? { ...base, allDay: true, startDate, endDate: addDays(endDate, 1) } : { ...base, allDay: false, startInstant: startInstant!, endInstant: endInstant!, timeZone }, name.trim());
    }}>Save as template</button><button type="button" className="danger" onClick={() => { if (confirm("Delete this event series?")) onDelete(event.id); }}>Delete</button></>}<button type="button" onClick={onClose}>Cancel</button><button className="add" disabled={invalid}>Save event</button></div>
  </form>;
  return embedded ? form : <div className="modalBackdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>{form}</div>;
}

function ScheduleEditor({ task, block, data, initialDate, today, now, onClose, onSave }: {
  task?: Task; block?: ScheduledBlock; data: Data; initialDate: string; today: string; now: Date;
  onClose: () => void; onSave: (block: ScheduledBlock) => void;
}) {
  const timeZone = block?.timeZone ?? zone();
  const measuredDuration = block ? Math.round((Date.parse(block.endInstant) - Date.parse(block.startInstant)) / 60_000) : 60;
  const storedDuration = Number.isFinite(measuredDuration) && measuredDuration > 0 ? measuredDuration : 60;
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [durationMinutes, setDurationMinutes] = useState(storedDuration);
  const durationOptions = [...new Set([30, 60, 90, 120, storedDuration])].sort((left, right) => left - right);
  const [selectedSlot, setSelectedSlot] = useState<{ startInstant: string; endInstant: string } | null>(() =>
    block ? { startInstant: block.startInstant, endInstant: block.endInstant } : null);
  const dayAgenda = dashboardDays(data, selectedDate, 1, today)[0];
  const allEvents = calendarEventsForDay(data, selectedDate, false);
  const visibleEvents = calendarEventsForDay(data, selectedDate, true);
  const visibleOccurrenceIds = new Set(visibleEvents.map(item => `${item.event.id}:${item.occurrenceDate}`));
  const allDayEvents = visibleEvents.filter(item => item.allDay);
  const hiddenEventCount = allEvents.filter(item => !visibleOccurrenceIds.has(`${item.event.id}:${item.occurrenceDate}`)).length;
  const dayStart = zonedDateTimeToInstant(selectedDate, "00:00", timeZone);
  const nextDayStart = zonedDateTimeToInstant(addDays(selectedDate, 1), "00:00", timeZone);
  const hiddenOrVisibleEventRanges: BusyTimeRange[] = allEvents.flatMap(item => {
    if (item.allDay || item.event.allDay) return dayStart && nextDayStart ? [{ startInstant: dayStart, endInstant: nextDayStart }] : [];
    if (!item.startInstant || !item.endInstant) return [];
    return [{ startInstant: item.startInstant, endInstant: item.endInstant }];
  });
  const plannedWork = dayAgenda?.scheduled ?? [];
  const blockRanges: BusyTimeRange[] = plannedWork.flatMap(({ block: planned }) => planned.id === block?.id ? [] :
    [{ startInstant: planned.startInstant, endInstant: planned.endInstant }]);
  const dueRanges: BusyTimeRange[] = (dayAgenda?.due ?? []).filter(item => item.dueTime &&
    !plannedWork.some(planned => planned.task.id === item.id)).flatMap(item => {
    const startInstant = zonedDateTimeToInstant(selectedDate, item.dueTime!, item.dueTimeZone ?? timeZone);
    return startInstant ? [{ startInstant, endInstant: new Date(Date.parse(startInstant) + 30 * 60_000).toISOString() }] : [];
  });
  const busyRanges = [...hiddenOrVisibleEventRanges, ...blockRanges, ...dueRanges];
  const availableSlots = availableWorkSlots(selectedDate, timeZone, busyRanges, durationMinutes, now.getTime());
  const timelineItems: CalendarTimelineItem[] = [
    ...visibleEvents.flatMap(item => {
      if (item.allDay || item.event.allDay || !item.startInstant || !item.endInstant) return [];
      const event = item.event;
      const eventStartDay = localDate(new Date(item.startInstant));
      const eventEndDay = localDate(new Date(Date.parse(item.endInstant) - 1));
      const start = eventStartDay < selectedDate
        ? zonedDateTimeToInstant(selectedDate, "00:00", event.timeZone) ?? item.startInstant
        : item.startInstant;
      const end = eventEndDay > selectedDate
        ? zonedDateTimeToInstant(addDays(selectedDate, 1), "00:00", event.timeZone) ?? item.endInstant
        : item.endInstant;
      return [{ id: `event:${event.id}:${item.occurrenceDate}`, title: event.title,
        caption: `${timeLabel(start)} – ${timeLabel(end)} · Event`, start, end,
        color: data.calendars.find(calendar => calendar.id === event.calendarId)?.color ?? defaultCalendarColor }];
    }),
    ...plannedWork.map(({ block: planned, task: plannedTask }) => ({ id: `block:${planned.id}`, title: plannedTask.title,
      caption: `${timeLabel(planned.startInstant)} – ${timeLabel(planned.endInstant)} · Planned work`,
      start: planned.startInstant, end: planned.endInstant, color: "#3982c4" })),
    ...(dayAgenda?.due ?? []).filter(item => item.dueTime && !plannedWork.some(planned => planned.task.id === item.id)).flatMap(item => {
      const start = zonedDateTimeToInstant(selectedDate, item.dueTime!, item.dueTimeZone ?? timeZone);
      if (!start) return [];
      const end = new Date(Date.parse(start) + 30 * 60_000).toISOString();
      return [{ id: `deadline:${item.id}`, title: item.title, caption: "Task deadline", start, end, color: "#cf6d27" }];
    })
  ];
  const invalid = !task || Boolean(task.completedAt || task.deletedAt) || !selectedSlot ||
    Date.parse(selectedSlot.endInstant) <= Date.parse(selectedSlot.startInstant);
  const changeDay = (date: string) => { setSelectedDate(date); setSelectedSlot(null); };
  return <div className="modalBackdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="editor scheduleDayEditor" role="dialog" aria-modal="true" aria-labelledby="schedule-day-title">
    <div className="editorHead"><div><span className="eyebrow">{block ? "EDIT PLANNED WORK" : "PLAN A WORK SESSION"}</span><h2 id="schedule-day-title">{task?.title ?? "Task unavailable"}</h2></div><button type="button" onClick={onClose} aria-label="Close schedule view">×</button></div>
    <p className="hint">Scheduling work does not change this task’s due date.</p>
    <div className="scheduleDayControls"><button type="button" aria-label="Previous day" disabled={addDays(selectedDate, -1) < historyStart(today)} onClick={() => changeDay(addDays(selectedDate, -1))}>‹</button><h3>{dateLabel(selectedDate)}</h3><button type="button" aria-label="Next day" onClick={() => changeDay(addDays(selectedDate, 1))}>›</button></div>
    <div className="fieldPair scheduleDuration"><label>Session length<CustomSelect value={String(durationMinutes)} onChange={event => { setDurationMinutes(Number(event.target.value)); setSelectedSlot(null); }}>{durationOptions.map(minutes => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} minutes` : minutes % 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes / 60} hour${minutes === 60 ? "" : "s"}`}</option>)}</CustomSelect></label><p className="hint">Open starts are shown every 30 minutes, from 6:00 AM to 10:00 PM.</p></div>
    {!!allDayEvents.length && <div className="scheduleAllDay" aria-label="All-day calendar events"><strong>All day</strong>{allDayEvents.map(item => <span key={`${item.event.id}:${item.occurrenceDate}`}>{item.event.title}</span>)}</div>}
    {!!hiddenEventCount && <p className="hint">Items on hidden calendars also reserve time.</p>}
    <h3 className="scheduleSectionHeading">Day view</h3>
    <div className="scheduleDayTimeline"><CalendarTimeline day={selectedDate} items={timelineItems} now={now} /></div>
    <div className="scheduleAvailability"><div className="scheduleAvailabilityHeader"><h3>Open time slots</h3><span>{availableSlots.length} available</span></div>
      {availableSlots.length ? <div className="scheduleSlots" role="group" aria-label="Available work time slots">{availableSlots.map(slot => {
        const selected = selectedSlot?.startInstant === slot.startInstant && selectedSlot.endInstant === slot.endInstant;
        return <button key={slot.startInstant} type="button" className={selected ? "scheduleSlotSelected" : ""} aria-pressed={selected} onClick={() => setSelectedSlot(slot)}>
          <span>{timeLabel(slot.startInstant)} – {timeLabel(slot.endInstant)}</span>{selected && <strong>Selected</strong>}
        </button>;
      })}</div> : <p className="scheduleNoSlots" role="status">{selectedDate < today ? "This day has passed. Choose today or a future day to book work." : "No open slots fit this session length."}</p>}
    </div>
    <p className="hint">Time zone: {timeZone}. Calendar events, planned work, and timed deadlines are treated as busy time.</p>
    <div className="editorActions"><button type="button" onClick={onClose}>Cancel</button><button type="button" className="add" disabled={invalid} onClick={() => {
      if (invalid || !task || !selectedSlot) return;
      onSave({ ...(block ?? newEntity()), taskId: task.id, startInstant: selectedSlot.startInstant, endInstant: selectedSlot.endInstant,
        timeZone, updatedAt: new Date().toISOString(), revision: block ? block.revision + 1 : 1 });
    }}>{block ? "Save new time" : "Schedule work"}</button></div>
  </section></div>;
}

function TaskEditor({ task, initialDate, initialProject, data, earliestDate, onClose, onSave, onDelete, embedded = false }: {
  task?: Task; initialDate?: string; initialProject?: string; data: Data; earliestDate: string; onClose: () => void;
  onSave: (task: Task, reminder: string) => void; onDelete: (id: string) => void;
  embedded?: boolean;
}) {
  const reminder = data.reminders.find(r => r.taskId === task?.id && !r.deletedAt);
  const [title, setTitle] = useState(task?.title ?? "");
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? initialDate ?? "");
  const [dueTime, setDueTime] = useState(task?.dueTime ?? "");
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "low");
  const [projectId, setProjectId] = useState(task?.projectId ?? initialProject ?? "");
  const [sectionId, setSectionId] = useState(task?.sectionId ?? "");
  const [tagIds, setTagIds] = useState(task?.tagIds ?? []);
  const [reminderMinutes, setReminderMinutes] = useState(reminder ? String(reminder.minutesBefore) : "");
  const [repeatSelection, setRepeatSelection] = useState<RepeatSelection>(() => repeatSelectionFor(task?.recurrence));
  const [weekdays, setWeekdays] = useState<number[]>(task?.recurrence?.weekdays ?? []);
  const [repeatUntil, setRepeatUntil] = useState(task?.recurrence?.until ?? "");
  const [repeatCount, setRepeatCount] = useState(task?.recurrence?.count ? String(task.recurrence.count) : "");
  const expiredDueDate = Boolean(dueDate && dueDate < earliestDate);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const content = <><form className={`editor${embedded ? " composerEditorEmbedded" : ""}`} onSubmit={e => {
    e.preventDefault(); if (!title.trim() || expiredDueDate || (repeatSelection && (!dueDate || (repeatUntil && repeatUntil < dueDate) || (repeatCount !== "" && Number(repeatCount) < 1)))) return;
    const stamp = new Date().toISOString();
    const repeatRule = recurrenceForRepeat(repeatSelection, weekdays);
    onSave({ ...(task ?? newEntity()), title: title.trim(), notes, priority, projectId: projectId || undefined, sectionId: projectId && sectionId ? sectionId : undefined,
      tagIds, sortKey: task?.sortKey ?? Date.now(), dueDate: dueDate || undefined,
      dueTime: dueDate && dueTime ? dueTime : undefined, dueTimeZone: dueDate && dueTime ? zone() : undefined, updatedAt: stamp, revision: task ? task.revision + 1 : 1,
      recurrence: repeatRule && dueDate ? { ...repeatRule,
        anchorDate: task?.dueDate === dueDate ? task?.recurrence?.anchorDate ?? dueDate : dueDate, occurrences: task?.recurrence?.occurrences ?? 0,
        until: repeatUntil || undefined,
        count: repeatCount ? Number(repeatCount) : undefined } : undefined
    }, reminderMinutes);
  }}>
    {!embedded && <div className="editorHead"><h2>{task ? "Edit task" : "New task"}</h2><button type="button" onClick={onClose} aria-label="Close editor">×</button></div>}
    <label>Title<input required value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?" /></label>
    <label>Notes<textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    <div className="fieldPair dateTimePair"><label>Date<DateField value={dueDate} min={earliestDate} clearable onChange={value => { setDueDate(value); if (!value) { setDueTime(""); setRepeatSelection(""); setRepeatUntil(""); setRepeatCount(""); setWeekdays([]); } }} /></label><label>Time<TimeField value={dueTime} disabled={!dueDate} onChange={setDueTime} /></label></div>
    {expiredDueDate && <p className="hint">Choose a date within the 31-day history window.</p>}
    <div className="fieldPair"><label>Priority<CustomSelect value={priority} onChange={e => setPriority(e.target.value as Priority)}>{priorities.map(p => <option key={p} value={p}>{priorityLabel(p)}</option>)}</CustomSelect></label><label>Project<CustomSelect value={projectId} onChange={e => { setProjectId(e.target.value); setSectionId(""); }}><option value="">Inbox</option>{data.projects.filter(p => !p.deletedAt && !p.archivedAt).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</CustomSelect></label></div>
    {projectId && <label>Section<CustomSelect value={sectionId} onChange={e => setSectionId(e.target.value)}><option value="">Project root</option>{data.sections.filter(s => s.projectId === projectId && !s.deletedAt).map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</CustomSelect></label>}
    {!!data.tags.length && <fieldset><legend>Tags</legend>{data.tags.filter(t => !t.deletedAt).map(t => <label className="checkLabel" key={t.id}><input type="checkbox" checked={tagIds.includes(t.id)} onChange={e => setTagIds(e.target.checked ? [...tagIds, t.id] : tagIds.filter(id => id !== t.id))} /> {t.name}</label>)}</fieldset>}
    <label>Repeat<CustomSelect value={repeatSelection} onChange={e => { const selection = e.target.value as RepeatSelection; setRepeatSelection(selection); const presetDays = defaultWeekdaysForRepeat(selection); if (presetDays) setWeekdays(presetDays); }}>{repeatOptionsFor(task?.recurrence).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</CustomSelect></label>
    {repeatUsesWeekdayPicker(repeatSelection) && <fieldset><legend>Repeat on</legend>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name, day) => <label className="checkLabel" key={day}><input type="checkbox" checked={weekdays.includes(day)} onChange={e => setWeekdays(e.target.checked ? [...weekdays, day] : weekdays.filter(value => value !== day))} /> {name}</label>)}<p className="hint">If none are selected, repeat on the original weekday.</p></fieldset>}
    {repeatSelection && <div className="fieldPair"><label>Repeat until<DateField value={repeatUntil} min={dueDate} onChange={setRepeatUntil} /></label><label>End after occurrences<input type="number" min="1" value={repeatCount} onChange={e => setRepeatCount(e.target.value)} placeholder="No limit" /></label></div>}
    <label>Reminder before deadline<CustomSelect value={reminderMinutes} onChange={e => setReminderMinutes(e.target.value)}><option value="">None</option><option value="0">At due time</option><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option><option value="1440">1 day</option></CustomSelect></label>
    {reminderMinutes !== "" && !dueTime && <p className="hint">Choose a due date and time for a timed reminder.</p>}
    <div className="editorActions">{task && <button type="button" className="danger" onClick={() => setDeleteConfirmationOpen(true)}>Delete</button>}<button type="button" onClick={onClose}>Cancel</button><button className="add" disabled={!title.trim() || expiredDueDate}>Save task</button></div>
  </form>{deleteConfirmationOpen && <div className="modalBackdrop" style={{ zIndex: 20 }} onMouseDown={event => { if (event.target === event.currentTarget) setDeleteConfirmationOpen(false); }}><section className="editor" role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title"><h2 id="delete-task-title">Delete task?</h2><p>“{task?.title}” and its scheduled work and reminders will be deleted. This cannot be undone.</p><div className="editorActions"><button type="button" onClick={() => setDeleteConfirmationOpen(false)}>Cancel</button><button type="button" className="danger" onClick={() => task && onDelete(task.id)}>Delete</button></div></section></div>}</>;
  return embedded ? content : <div className="modalBackdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>{content}</div>;
}
