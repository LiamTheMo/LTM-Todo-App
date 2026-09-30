import { emptyData, localDate, pruneExpiredHistory, type Data } from "./domain.ts";

const DB_NAME = "ltm-todo";
const STORE = "state";
const KEY = "local";
export function normalizeData(value: unknown): Data {
  if (value == null) return emptyData();
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid local task data");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) throw new Error("Unsupported local data version");
  const collections = ["tasks", "projects", "sections", "tags", "blocks", "reminders", "completions", "savedViews"] as const;
  for (const name of collections) {
    if (raw[name] !== undefined && !Array.isArray(raw[name])) throw new Error(`Invalid ${name} collection`);
  }
  if (raw.generation !== undefined && (!Number.isSafeInteger(raw.generation) || (raw.generation as number) < 0)) {
    throw new Error("Invalid local data generation");
  }
  // Older v1 snapshots may predate some collections and the generation counter.
  const normalized = { ...raw };
  for (const name of collections) normalized[name] ??= [];
  const data = { ...emptyData(), ...normalized, generation: (raw.generation as number | undefined) ?? 0 } as Data;
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
  const taskIds = new Set(data.tasks.map(task => task.id));
  const projectIds = new Set(data.projects.map(project => project.id));
  const sectionIds = new Set(data.sections.map(section => section.id));
  const tagIds = new Set(data.tags.map(tag => tag.id));
  for (const task of data.tasks) {
    if (task.parentTaskId && (!taskIds.has(task.parentTaskId) || task.parentTaskId === task.id)) throw new Error("Invalid task parent relationship");
    if (task.parentTaskId && data.tasks.some(parent => parent.id === task.parentTaskId && parent.parentTaskId)) throw new Error("Subtasks may only have one level of nesting");
    if (task.parentTaskId && data.tasks.some(parent => parent.id === task.parentTaskId && parent.projectId !== task.projectId)) throw new Error("Subtask and parent must share a project");
    if (task.projectId && !projectIds.has(task.projectId)) throw new Error("Task refers to a missing project");
    if (task.sectionId && (!sectionIds.has(task.sectionId) || !data.sections.some(section => section.id === task.sectionId && section.projectId === task.projectId))) throw new Error("Task refers to an invalid section");
    if (task.tagIds.some(id => !tagIds.has(id))) throw new Error("Task refers to a missing tag");
  }
  for (const section of data.sections) if (!projectIds.has(section.projectId)) throw new Error("Section refers to a missing project");
  for (const item of [...data.blocks, ...data.reminders]) if (!taskIds.has(item.taskId)) throw new Error("Task data contains a missing task reference");
  for (const completion of data.completions) if (!taskIds.has(completion.taskId)) throw new Error("Completion refers to a missing task");
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
          const stored = normalizeData(request.result);
          const retained = pruneExpiredHistory(stored, today);
          if (retained !== stored) {
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
