import { normalizeCalendarColor, validEvent } from "./calendar-domain.ts";
import { emptyData, localDate, pruneExpiredHistory, type Data } from "./domain.ts";
import { SYNC_CLIENT_SCHEMA_VERSION, type SyncEntityType, type SyncMutation } from "./sync-protocol.ts";
import type { SyncChange } from "./sync-api.ts";
import { syncEntityPriority } from "./sync-entity-order.ts";

const DB_NAME = "ltm-todo";
const STORE = "state";
const KEY = "local";
const JOURNAL = "sync-journal";
const SYNC_META = "sync-meta";
const CONFLICTS = "sync-conflicts";
const ATTACHMENT_OUTBOX = "attachment-outbox";
const ICS_CACHE = "ics-calendar-cache";
const collectionTypes = ["tasks", "projects", "sections", "tags", "blocks", "calendars", "calendarEvents", "taskTemplates", "eventTemplates", "routines", "reminders", "completions", "savedViews"] as const;
const builtInCalendarId = "00000000-0000-4000-8000-000000000001";
type JournalEntry = { key: string; mutation: SyncMutation; queuedAt: number };
export type SyncConflict = { key: string; mutation: SyncMutation; current?: SyncChange; foundAt: string };
const entityKey = (type: string, id: string) => `${type}:${id}`;
function normalizeTaskPriority(value: unknown): "low" | "medium" | "high" {
  if (value === undefined || value === null || value === "none") return "low";
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("Invalid local task priority");
}
function sameSyncValue(type: typeof collectionTypes[number], id: string, before: unknown, after: unknown): boolean {
  if (type !== "calendars" || id !== builtInCalendarId || !before || !after) return JSON.stringify(before) === JSON.stringify(after);
  const stable = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) =>
    key !== "createdAt" && key !== "updatedAt" && key !== "revision").sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify(stable(before as Record<string, unknown>)) === JSON.stringify(stable(after as Record<string, unknown>));
}
export function normalizeData(value: unknown): Data {
  if (value == null) return emptyData();
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid local task data");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2 && raw.schemaVersion !== 3 && raw.schemaVersion !== 4) throw new Error("Unsupported local data version");
  const migratingV1 = raw.schemaVersion === 1;
  const collections = ["tasks", "projects", "sections", "tags", "blocks", "calendars", "calendarEvents", "taskTemplates", "eventTemplates", "routines", "reminders", "completions", "savedViews"] as const;
  for (const name of collections) {
    if (raw[name] !== undefined && !Array.isArray(raw[name])) throw new Error(`Invalid ${name} collection`);
  }
  if (raw.generation !== undefined && (!Number.isSafeInteger(raw.generation) || (raw.generation as number) < 0)) {
    throw new Error("Invalid local data generation");
  }
  // v1 snapshots may predate collections added by later phases and the generation counter.
  const normalized = { ...raw };
  for (const name of collections) normalized[name] ??= [];
  if (migratingV1 && !(normalized.calendars as unknown[]).length) normalized.calendars = emptyData().calendars;
  normalized.tasks = (normalized.tasks as Array<Record<string, unknown>>).map(task => {
    const standalone = { ...task };
    delete standalone.parentTaskId;
    standalone.priority = normalizeTaskPriority(standalone.priority);
    return standalone;
  });
  normalized.taskTemplates = (normalized.taskTemplates as Array<Record<string, unknown>>).map(template => ({
    ...template, priority: normalizeTaskPriority(template.priority)
  }));
  normalized.savedViews = (normalized.savedViews as Array<Record<string, unknown>>).map(view => ({
    ...view, priority: view.priority === "none" ? "low" : view.priority
  }));
  const data = { ...emptyData(), ...normalized, schemaVersion: 4,
    generation: (raw.generation as number | undefined) ?? 0 } as Data;
  for (const name of collections) {
    const ids = new Set<string>();
    for (const item of data[name]) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || ids.has(item.id)) {
        throw new Error(`Invalid or duplicate ${name} identity`);
      }
      const entity = item as { createdAt?: unknown; updatedAt?: unknown; revision?: unknown };
      if (name !== "completions" && (typeof entity.createdAt !== "string" || typeof entity.updatedAt !== "string" ||
          !Number.isSafeInteger(entity.revision) || (entity.revision as number) < 1)) {
        throw new Error(`Invalid ${name} record`);
      }
      ids.add(item.id);
    }
  }
  for (const task of data.tasks) {
    if (typeof task.title !== "string" || !task.title.trim() || !Array.isArray(task.tagIds) ||
        !Number.isFinite(task.sortKey) || !["low", "medium", "high"].includes(task.priority)) {
      throw new Error("Invalid local task record");
    }
  }
  for (const completion of data.completions) {
    if (typeof completion.taskId !== "string" || typeof completion.completedAt !== "string") {
      throw new Error("Invalid completion record");
    }
  }
  for (const calendar of data.calendars) {
    const color = normalizeCalendarColor(calendar.color);
    if (typeof calendar.name !== "string" || !calendar.name.trim() ||
        !color || typeof calendar.visible !== "boolean" || !Number.isFinite(calendar.sortKey)) {
      throw new Error("Invalid local calendar record");
    }
    calendar.color = color;
  }
  const calendarIds = new Set(data.calendars.map(calendar => calendar.id));
  for (const template of data.taskTemplates) {
    if (typeof template.name !== "string" || !template.name.trim() || typeof template.title !== "string" || !template.title.trim() ||
        typeof template.notes !== "string" || !Array.isArray(template.tagIds) || !["low", "medium", "high"].includes(template.priority)) {
      throw new Error("Invalid task template record");
    }
  }
  for (const template of data.eventTemplates) {
    if (typeof template.name !== "string" || !template.name.trim() || typeof template.title !== "string" || !template.title.trim() ||
        typeof template.notes !== "string" || !calendarIds.has(template.calendarId) || typeof template.allDay !== "boolean" ||
        !Number.isSafeInteger(template.duration) || template.duration < 1 || (template.allDay ? false :
          (typeof template.timeZone !== "string" || typeof template.startTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(template.startTime)))) {
      throw new Error("Invalid event template record");
    }
  }
  const templateIds = new Set(data.taskTemplates.map(template => template.id));
  const taskIds = new Set(data.tasks.map(task => task.id));
  for (const routine of data.routines) {
    const rule = routine.recurrence;
    if (!templateIds.has(routine.templateId) || !taskIds.has(routine.taskId) || typeof routine.name !== "string" || !routine.name.trim() ||
        typeof routine.enabled !== "boolean" || !/^\d{4}-\d{2}-\d{2}$/.test(routine.startDate) || !rule ||
        !["daily", "weekly", "monthly", "yearly"].includes(rule.frequency) || !Number.isSafeInteger(rule.interval) || rule.interval < 1 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(rule.anchorDate) || !Number.isSafeInteger(rule.occurrences) || rule.occurrences < 0) {
      throw new Error("Invalid routine record");
    }
  }
  for (const event of data.calendarEvents) {
    if (!calendarIds.has(event.calendarId) || !validEvent(event)) throw new Error("Invalid calendar event record");
  }
  const projectIds = new Set(data.projects.map(project => project.id));
  const sectionsById = new Map(data.sections.map(section => [section.id, section]));
  const tagIds = new Set(data.tags.map(tag => tag.id));
  const tasksById = new Map(data.tasks.map(task => [task.id, task]));
  for (const task of data.tasks) {
    if (task.projectId && !projectIds.has(task.projectId)) throw new Error("Task refers to a missing project");
    const section = task.sectionId ? sectionsById.get(task.sectionId) : undefined;
    if (task.sectionId && (!section || section.projectId !== task.projectId)) throw new Error("Task refers to an invalid section");
    if (task.tagIds.some(id => !tagIds.has(id))) throw new Error("Task refers to a missing tag");
  }
  for (const section of data.sections) if (!projectIds.has(section.projectId)) throw new Error("Section refers to a missing project");
  for (const template of data.taskTemplates) {
    const section = template.sectionId ? sectionsById.get(template.sectionId) : undefined;
    if ((template.projectId && !projectIds.has(template.projectId)) ||
        (template.sectionId && (!section || section.projectId !== template.projectId)) ||
        template.tagIds.some(id => !tagIds.has(id))) throw new Error("Task template refers to missing task data");
  }
  for (const item of [...data.blocks, ...data.reminders]) if (!tasksById.has(item.taskId)) throw new Error("Task data contains a missing task reference");
  for (const completion of data.completions) if (!tasksById.has(completion.taskId)) throw new Error("Completion refers to a missing task");
  return data;
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 4);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(JOURNAL)) db.createObjectStore(JOURNAL, { keyPath: "key" });
      if (!db.objectStoreNames.contains(SYNC_META)) db.createObjectStore(SYNC_META);
      if (!db.objectStoreNames.contains(CONFLICTS)) db.createObjectStore(CONFLICTS, { keyPath: "key" });
      if (!db.objectStoreNames.contains(ATTACHMENT_OUTBOX)) db.createObjectStore(ATTACHMENT_OUTBOX, { keyPath: "id" });
      if (!db.objectStoreNames.contains(ICS_CACHE)) db.createObjectStore(ICS_CACHE, { keyPath: "subscriptionId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export type CachedIcsCalendar = {
  subscriptionId: string;
  calendarId: string;
  name: string;
  color: string;
  visible: boolean;
  lastRefreshAt?: string;
  nextRefreshAt?: string;
  lastError?: "refresh_failed";
  events: Array<{ uid: string; recurrenceId: string; title: string; start: string; end: string; allDay: boolean }>;
};

export async function readIcsCalendarCache(): Promise<CachedIcsCalendar[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(ICS_CACHE, "readonly");
      const request = transaction.objectStore(ICS_CACHE).getAll();
      request.onsuccess = () => resolve(request.result as CachedIcsCalendar[]);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function persistIcsCalendarCache(items: CachedIcsCalendar[]): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ICS_CACHE, "readwrite");
      const store = transaction.objectStore(ICS_CACHE);
      store.clear();
      for (const item of items) store.put(item);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export type PendingAttachmentUpload = { id: string; uploadId: string; taskId: string; fileName: string; mediaType: string; blob: Blob; queuedAt: number };

export async function queueAttachmentUpload(input: Omit<PendingAttachmentUpload, "id" | "uploadId" | "queuedAt">): Promise<PendingAttachmentUpload> {
  if (!input.taskId || !input.fileName || !input.mediaType || !(input.blob instanceof Blob) || input.blob.size < 1 || input.blob.size > 10 * 1024 * 1024) {
    throw new Error("Attachment is invalid or exceeds 10 MiB");
  }
  const item = { ...input, id: crypto.randomUUID(), uploadId: crypto.randomUUID(), queuedAt: Date.now() };
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ATTACHMENT_OUTBOX, "readwrite");
      transaction.objectStore(ATTACHMENT_OUTBOX).add(item);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("Attachment could not be queued"));
      transaction.onerror = () => reject(transaction.error);
    });
    return item;
  } finally { db.close(); }
}

export async function readPendingAttachmentUploads(): Promise<PendingAttachmentUpload[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(ATTACHMENT_OUTBOX, "readonly");
      const request = transaction.objectStore(ATTACHMENT_OUTBOX).getAll();
      request.onsuccess = () => resolve((request.result as PendingAttachmentUpload[]).sort((left, right) => left.queuedAt - right.queuedAt));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function acknowledgeAttachmentUpload(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(ATTACHMENT_OUTBOX, "readwrite");
      transaction.objectStore(ATTACHMENT_OUTBOX).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("Attachment upload acknowledgement failed"));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
export async function readData(today = localDate(new Date())): Promise<Data> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      let result: Data | undefined;
      let failure: Error | undefined;
      const request = store.get(KEY);
      request.onsuccess = () => {
        try {
          const legacy = request.result !== undefined && (request.result as { schemaVersion?: number }).schemaVersion !== 4;
          const stored = normalizeData(request.result);
          const retained = pruneExpiredHistory(stored, today);
          if (legacy || retained !== stored) {
            result = { ...retained, generation: stored.generation + 1 };
            store.put(result, KEY);
          } else result = stored;
        } catch (error) {
          failure = error instanceof Error ? error : new Error("Local task data could not be read");
          transaction.abort();
        }
      };
      request.onerror = () => { failure = request.error ?? new Error("Local task data could not be read"); };
      transaction.oncomplete = () => result ? resolve(result) : reject(failure ?? new Error("Local task data could not be read"));
      transaction.onerror = () => reject(failure ?? transaction.error);
      transaction.onabort = () => reject(failure ?? transaction.error);
    });
  } finally { db.close(); }
}
export async function writeData(data: Data, expectedGeneration: number): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE, JOURNAL, SYNC_META], "readwrite");
      const store = transaction.objectStore(STORE);
      const journal = transaction.objectStore(JOURNAL);
      const syncMeta = transaction.objectStore(SYNC_META);
      let failure: Error | undefined;
      const request = store.get(KEY);
      request.onsuccess = () => {
        try {
          const previous = normalizeData(request.result);
          if (previous.generation !== expectedGeneration || data.generation !== expectedGeneration + 1) {
            throw new Error("Local data changed in another tab. Download an unsaved backup before reloading.");
          }
          store.put(data, KEY);
          const oldByType = new Map(collectionTypes.map(type => [type, new Map((previous[type] as Array<{ id: string }>).map(item => [item.id, item]))]));
          const newByType = new Map(collectionTypes.map(type => [type, new Map((data[type] as Array<{ id: string }>).map(item => [item.id, item]))]));
          const changed: Array<{ type: typeof collectionTypes[number]; id: string; value?: Record<string, unknown> }> = [];
          for (const type of collectionTypes) {
            const oldItems = oldByType.get(type)!;
            const newItems = newByType.get(type)!;
            for (const [id, value] of newItems) {
              if (!sameSyncValue(type, id, oldItems.get(id), value)) changed.push({ type, id, value: value as Record<string, unknown> });
            }
            for (const id of oldItems.keys()) if (!newItems.has(id)) changed.push({ type, id });
          }
          for (const change of changed) {
            const key = entityKey(change.type, change.id);
            const pendingRequest = journal.get(key);
            const revisionRequest = syncMeta.get(`revision:${key}`);
            pendingRequest.onsuccess = () => revisionRequest.onsuccess = () => {
              const prior = pendingRequest.result as JournalEntry | undefined;
              const serverRevision = Number(revisionRequest.result ?? 0);
              if (!change.value && !serverRevision) {
                journal.delete(key);
                return;
              }
              const mutation: SyncMutation = {
                entityType: change.type as SyncEntityType, entityId: change.id,
                baseRevision: prior?.mutation.baseRevision ?? serverRevision,
                operation: change.value ? "upsert" : "delete",
                clientMutationId: crypto.randomUUID(), clientSchemaVersion: SYNC_CLIENT_SCHEMA_VERSION,
                ...(change.value ? { payload: change.value } : {})
              };
              journal.put({ key, mutation, queuedAt: Date.now() } satisfies JournalEntry);
            };
          }
        } catch (error) {
          failure = error instanceof Error ? error : new Error("Local data could not be validated");
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(failure ?? transaction.error);
    });
  } finally { db.close(); }
}

export async function readPendingSyncMutations(limit: number): Promise<SyncMutation[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(JOURNAL, "readonly");
      const request = transaction.objectStore(JOURNAL).getAll();
      request.onsuccess = () => {
        const entries = (request.result as JournalEntry[]).sort((left, right) =>
          (syncEntityPriority[left.mutation.entityType] ?? 99) - (syncEntityPriority[right.mutation.entityType] ?? 99) || left.queuedAt - right.queuedAt);
        resolve(entries.slice(0, limit).map(entry => entry.mutation));
      };
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function bindSyncAccount(accountKey: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(accountKey)) return false;
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(SYNC_META, "readwrite");
      const store = transaction.objectStore(SYNC_META);
      const request = store.get("account");
      let allowed = false;
      request.onsuccess = () => {
        const current = request.result;
        allowed = typeof current !== "string" || current === accountKey;
        if (allowed && current === undefined) store.put(accountKey, "account");
      };
      transaction.oncomplete = () => resolve(allowed);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

/** After the initial cloud snapshot, queue records that predate the sync journal, including the default calendar. */
export async function prepareInitialSyncUpload(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE, JOURNAL, SYNC_META, CONFLICTS], "readwrite");
      const journal = transaction.objectStore(JOURNAL);
      const metadata = transaction.objectStore(SYNC_META);
      const conflicts = transaction.objectStore(CONFLICTS);
      const state = transaction.objectStore(STORE).get(KEY);
      let failure: unknown;
      state.onsuccess = () => {
        try {
          const data = normalizeData(state.result);
          for (const type of collectionTypes) for (const item of data[type]) {
            if ("deletedAt" in item && item.deletedAt) continue;
            const key = entityKey(type, item.id);
            const revision = metadata.get(`revision:${key}`);
            const pending = journal.get(key);
            const conflict = conflicts.get(key);
            const queueIfReady = () => {
              if ([revision, pending, conflict].some(request => request.readyState !== "done")) return;
              if (revision.result !== undefined || pending.result || conflict.result) return;
              journal.put({ key, queuedAt: Date.now(), mutation: {
                entityType: type, entityId: item.id, operation: "upsert", baseRevision: 0,
                clientMutationId: crypto.randomUUID(), clientSchemaVersion: SYNC_CLIENT_SCHEMA_VERSION,
                payload: item
              } } satisfies JournalEntry);
            };
            revision.onsuccess = pending.onsuccess = conflict.onsuccess = queueIfReady;
          }
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(failure ?? transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function acknowledgeSyncMutation(mutation: SyncMutation, revision: number): Promise<void> {
  const db = await openDatabase();
  const key = entityKey(mutation.entityType, mutation.entityId);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([JOURNAL, SYNC_META], "readwrite");
      const journal = transaction.objectStore(JOURNAL);
      const pending = journal.get(key);
      pending.onsuccess = () => {
        if ((pending.result as JournalEntry | undefined)?.mutation.clientMutationId === mutation.clientMutationId) journal.delete(key);
        transaction.objectStore(SYNC_META).put(revision, `revision:${key}`);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function recordSyncConflict(mutation: SyncMutation, current?: SyncChange): Promise<void> {
  const db = await openDatabase();
  const key = entityKey(mutation.entityType, mutation.entityId);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([CONFLICTS, SYNC_META], "readwrite");
      transaction.objectStore(CONFLICTS).put({ key, mutation, current, foundAt: new Date().toISOString() } satisfies SyncConflict);
      if (current) transaction.objectStore(SYNC_META).put(current.revision, `revision:${key}`);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function getSyncCursor(): Promise<string | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(SYNC_META, "readonly");
      const request = transaction.objectStore(SYNC_META).get("cursor");
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function persistSyncCursor(cursor: string | undefined): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SYNC_META, "readwrite");
      if (cursor) transaction.objectStore(SYNC_META).put(cursor, "cursor");
      else transaction.objectStore(SYNC_META).delete("cursor");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function getSyncSnapshotCursor(): Promise<string | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(SYNC_META, "readonly");
      const request = transaction.objectStore(SYNC_META).get("snapshot-cursor");
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function persistSyncSnapshotCursor(cursor: string | undefined): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SYNC_META, "readwrite");
      if (cursor) transaction.objectStore(SYNC_META).put(cursor, "snapshot-cursor");
      else transaction.objectStore(SYNC_META).delete("snapshot-cursor");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export async function applyRemoteSyncChanges(changes: SyncChange[]): Promise<void> {
  if (!changes.length) return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE, JOURNAL, SYNC_META, CONFLICTS], "readwrite");
      const stateStore = transaction.objectStore(STORE);
      const journal = transaction.objectStore(JOURNAL);
      const syncMeta = transaction.objectStore(SYNC_META);
      const conflicts = transaction.objectStore(CONFLICTS);
      const currentData = stateStore.get(KEY);
      const pendingEntries = journal.getAll();
      currentData.onerror = () => transaction.abort();
      pendingEntries.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
      let applied = false;
      const applyIfReady = () => {
        if (applied || currentData.readyState !== "done" || pendingEntries.readyState !== "done") return;
        applied = true;
        try {
          let data = normalizeData(currentData.result);
          const pendingByKey = new Map((pendingEntries.result as JournalEntry[]).map(item => [item.key, item]));
          for (const change of changes) {
            const key = entityKey(change.entityType, change.entityId);
            const pending = pendingByKey.get(key);
            syncMeta.put(change.revision, `revision:${key}`);
            if (pending) {
              conflicts.put({ key, mutation: pending.mutation, current: change, foundAt: new Date().toISOString() } satisfies SyncConflict);
              continue;
            }
            const type = change.entityType as typeof collectionTypes[number];
            if (!collectionTypes.includes(type)) throw new Error("Unknown synced entity type");
            const records = data[type] as Array<Record<string, unknown>>;
            const index = records.findIndex(item => item.id === change.entityId);
            let replacement: Record<string, unknown> | undefined;
            if (change.deletedAt) {
              if (index >= 0) replacement = { ...records[index], deletedAt: change.deletedAt, revision: Math.max(Number(records[index].revision ?? 0) + 1, change.revision), updatedAt: change.updatedAt };
            } else if (change.payload) replacement = { ...change.payload, revision: Math.max(Number(change.payload.revision ?? 0), change.revision) };
            if (replacement) {
              const updated = records.slice();
              if (index >= 0) updated[index] = replacement;
              else updated.push(replacement);
              data = { ...data, [type]: updated } as Data;
            }
          }
          data = normalizeData({ ...data, generation: data.generation + 1 });
          stateStore.put(data, KEY);
        } catch (error) {
          try { transaction.abort(); } catch { /* no-op */ }
          reject(error);
        }
      };
      currentData.onsuccess = applyIfReady;
      pendingEntries.onsuccess = applyIfReady;
    });
  } finally { db.close(); }
}

export async function hasSyncConflicts(): Promise<boolean> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(CONFLICTS, "readonly");
      const request = transaction.objectStore(CONFLICTS).count();
      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function readSyncConflicts(): Promise<SyncConflict[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(CONFLICTS, "readonly");
      const request = transaction.objectStore(CONFLICTS).getAll();
      request.onsuccess = () => resolve(request.result as SyncConflict[]);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function resolveSyncConflict(key: string, choice: "local" | "remote"): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([STORE, JOURNAL, SYNC_META, CONFLICTS], "readwrite");
      const stateStore = transaction.objectStore(STORE);
      const journal = transaction.objectStore(JOURNAL);
      const conflicts = transaction.objectStore(CONFLICTS);
      const conflictRequest = conflicts.get(key);
      const dataRequest = stateStore.get(KEY);
      let ready = 0;
      const finish = () => {
        if (++ready !== 2) return;
        const conflict = conflictRequest.result as SyncConflict | undefined;
        if (!conflict) { transaction.abort(); return; }
        if (choice === "local") {
          const data = normalizeData(dataRequest.result);
          const type = conflict.mutation.entityType as typeof collectionTypes[number];
          const local = collectionTypes.includes(type)
            ? (data[type] as Array<Record<string, unknown>>).find(item => item.id === conflict.mutation.entityId)
            : undefined;
          const mutation: SyncMutation = { ...conflict.mutation, baseRevision: conflict.current?.revision ?? 0,
            clientMutationId: crypto.randomUUID(), operation: local ? "upsert" : "delete",
            ...(local ? { payload: local } : {}) };
          if (!local) delete mutation.payload;
          journal.put({ key, mutation, queuedAt: Date.now() } satisfies JournalEntry);
        } else {
          journal.delete(key);
          const current = conflict.current;
          if (current) {
            const data = normalizeData(dataRequest.result);
            const type = current.entityType as typeof collectionTypes[number];
            if (!collectionTypes.includes(type)) { transaction.abort(); return; }
            const records = data[type] as Array<Record<string, unknown>>;
            const index = records.findIndex(item => item.id === current.entityId);
            let updated = records;
            if (current.deletedAt) {
              updated = index < 0 ? records : records.map(item => item.id === current.entityId ? { ...item, deletedAt: current.deletedAt,
                updatedAt: current.updatedAt, revision: Math.max(Number(item.revision ?? 0) + 1, current.revision) } : item);
            } else if (current.payload) {
              const entity = { ...current.payload, revision: Math.max(Number(current.payload.revision ?? 0), current.revision) };
              updated = index < 0 ? [...records, entity] : records.map(item => item.id === current.entityId ? entity : item);
            }
            stateStore.put(normalizeData({ ...data, [type]: updated, generation: data.generation + 1 }), KEY);
          }
        }
        conflicts.delete(key);
      };
      conflictRequest.onsuccess = finish;
      dataRequest.onsuccess = finish;
      conflictRequest.onerror = () => transaction.abort();
      dataRequest.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("Sync conflict could not be resolved"));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
