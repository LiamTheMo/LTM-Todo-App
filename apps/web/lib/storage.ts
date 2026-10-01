import { calendarColors, validEvent } from "./calendar-domain.ts";
import { emptyData, localDate, pruneExpiredHistory, type Data } from "./domain.ts";

const DB_NAME = "ltm-todo";
const STORE = "state";
const KEY = "local";
export function normalizeData(value: unknown): Data {
  if (value == null) return emptyData();
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid local task data");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) throw new Error("Unsupported local data version");
  const migratingV1 = raw.schemaVersion === 1;
  const collections = ["tasks", "projects", "sections", "tags", "blocks", "calendars", "calendarEvents", "reminders", "completions", "savedViews"] as const;
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
  const data = { ...emptyData(), ...normalized, schemaVersion: 2,
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
        !Number.isFinite(task.sortKey)) {
      throw new Error("Invalid local task record");
    }
  }
  for (const completion of data.completions) {
    if (typeof completion.taskId !== "string" || typeof completion.completedAt !== "string") {
      throw new Error("Invalid completion record");
    }
  }
  for (const calendar of data.calendars) {
    if (typeof calendar.name !== "string" || !calendar.name.trim() ||
        !calendarColors.includes(calendar.color) || typeof calendar.visible !== "boolean" || !Number.isFinite(calendar.sortKey)) {
      throw new Error("Invalid local calendar record");
    }
  }
  const calendarIds = new Set(data.calendars.map(calendar => calendar.id));
  for (const event of data.calendarEvents) {
    if (!calendarIds.has(event.calendarId) || !validEvent(event)) throw new Error("Invalid calendar event record");
  }
  const projectIds = new Set(data.projects.map(project => project.id));
  const sectionsById = new Map(data.sections.map(section => [section.id, section]));
  const tagIds = new Set(data.tags.map(tag => tag.id));
  const tasksById = new Map(data.tasks.map(task => [task.id, task]));
  for (const task of data.tasks) {
    if (task.parentTaskId && (!tasksById.has(task.parentTaskId) || task.parentTaskId === task.id)) throw new Error("Invalid task parent relationship");
    const parent = task.parentTaskId ? tasksById.get(task.parentTaskId) : undefined;
    if (parent?.parentTaskId) throw new Error("Subtasks may only have one level of nesting");
    if (parent && parent.projectId !== task.projectId) throw new Error("Subtask and parent must share a project");
    if (task.projectId && !projectIds.has(task.projectId)) throw new Error("Task refers to a missing project");
    const section = task.sectionId ? sectionsById.get(task.sectionId) : undefined;
    if (task.sectionId && (!section || section.projectId !== task.projectId)) throw new Error("Task refers to an invalid section");
    if (task.tagIds.some(id => !tagIds.has(id))) throw new Error("Task refers to a missing tag");
  }
  for (const section of data.sections) if (!projectIds.has(section.projectId)) throw new Error("Section refers to a missing project");
  for (const item of [...data.blocks, ...data.reminders]) if (!tasksById.has(item.taskId)) throw new Error("Task data contains a missing task reference");
  for (const completion of data.completions) if (!tasksById.has(completion.taskId)) throw new Error("Completion refers to a missing task");
  return data;
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
          const legacy = request.result !== undefined && (request.result as { schemaVersion?: number }).schemaVersion !== 2;
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
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      let failure: Error | undefined;
      const request = store.get(KEY);
      request.onsuccess = () => {
        try {
          if (normalizeData(request.result).generation !== expectedGeneration || data.generation !== expectedGeneration + 1) {
            throw new Error("Local data changed in another tab. Download an unsaved backup before reloading.");
          }
          store.put(data, KEY);
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
