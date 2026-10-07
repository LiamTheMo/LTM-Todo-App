export const SYNC_PROTOCOL_VERSION = 1 as const;
export const SYNC_CLIENT_SCHEMA_VERSION = 4 as const;
export const MAX_SYNC_BATCH = 12;
export const MAX_SYNC_BODY_BYTES = 1_000_000;
export const MAX_SYNC_ENTITY_BYTES = 128_000;
export const MAX_SYNC_RESPONSE_BYTES = 2_000_000;
export const MAX_SYNC_PAGE_SIZE = 12;

export const syncEntityTypes = [
  "tasks", "projects", "sections", "tags", "blocks", "calendars", "calendarEvents",
  "taskTemplates", "eventTemplates", "routines", "reminders", "completions", "savedViews", "preferences"
] as const;

export type SyncEntityType = typeof syncEntityTypes[number];
export type SyncMutation = {
  entityType: SyncEntityType;
  entityId: string;
  baseRevision: number;
  operation: "upsert" | "delete";
  clientMutationId: string;
  clientSchemaVersion: number;
  payload?: Record<string, unknown>;
};
export type SyncPushBatch = { protocolVersion: 1; mutations: SyncMutation[] };
export type ProtocolFailure = { ok: false; code: "unsupported_protocol" | "unsupported_schema" | "invalid_request" | "request_too_large"; message: string };
export type ProtocolSuccess<T> = { ok: true; value: T };
export type ProtocolResult<T> = ProtocolSuccess<T> | ProtocolFailure;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
// `none` remains accepted on the wire for already-open/older clients; local storage migrates it to Low.
const wirePriorities = ["none", "low", "medium", "high"];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function safeJson(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 20_000 && value.every(item => safeJson(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, item]) => !forbiddenKeys.has(key) && safeJson(item, depth + 1));
}

const text = (value: unknown): value is string => typeof value === "string";
const nonEmptyText = (value: unknown): value is string => text(value) && Boolean(value.trim());
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const bool = (value: unknown): value is boolean => typeof value === "boolean";
const textList = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const dateOnly = (value: unknown): value is string => {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const instant = (value: unknown): value is string => text(value) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const validTimeZone = (value: unknown): value is string => {
  if (!nonEmptyText(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
};
const entityMeta = (payload: Record<string, unknown>) => text(payload.createdAt) && instant(payload.createdAt) &&
  text(payload.updatedAt) && instant(payload.updatedAt) && Number.isSafeInteger(payload.revision) && (payload.revision as number) >= 1;
const entityKeys = ["id", "createdAt", "updatedAt", "revision", "deletedAt"];
const hasOnlyKeys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
const optionalDate = (value: unknown) => value === undefined || dateOnly(value);
const optionalInstant = (value: unknown) => value === undefined || instant(value);
const optionalUuid = (value: unknown) => value === undefined || (text(value) && uuid.test(value));
const optionalTime = (value: unknown) => value === undefined || (text(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
const optionalCount = (value: unknown) => value === undefined || (Number.isSafeInteger(value) && (value as number) >= 1);

function validRecurrence(value: unknown, task: boolean): boolean {
  if (!isRecord(value)) return false;
  const allowed = task ? ["frequency", "interval", "weekdays", "until", "count", "anchorDate", "occurrences"] :
    ["frequency", "interval", "weekdays", "until", "count"];
  return hasOnlyKeys(value, allowed) && ["daily", "weekly", "monthly", "yearly"].includes(String(value.frequency)) &&
    Number.isSafeInteger(value.interval) && (value.interval as number) >= 1 &&
    (value.weekdays === undefined || (Array.isArray(value.weekdays) && value.weekdays.every(day => Number.isSafeInteger(day) && day >= 0 && day <= 6))) &&
    optionalDate(value.until) && optionalCount(value.count) &&
    (task ? dateOnly(value.anchorDate) && Number.isSafeInteger(value.occurrences) && (value.occurrences as number) >= 0 : true);
}

function validEntityPayload(type: SyncEntityType, payload: Record<string, unknown>): boolean {
  if (payload.accountId !== undefined || payload.ownerId !== undefined) return false;
  if (type === "completions") {
    return hasOnlyKeys(payload, ["id", "taskId", "occurrenceDate", "completedAt", "clearedBlockIds"]) &&
      typeof payload.taskId === "string" && uuid.test(payload.taskId) && instant(payload.completedAt) &&
      optionalDate(payload.occurrenceDate) && (payload.clearedBlockIds === undefined ||
        (textList(payload.clearedBlockIds) && payload.clearedBlockIds.every(id => uuid.test(id))));
  }
  if (!entityMeta(payload) || (payload.deletedAt !== undefined && !instant(payload.deletedAt))) return false;
  switch (type) {
    case "preferences": return hasOnlyKeys(payload, [...entityKeys, "completedTaskRetentionDays"]) && payload.id === "00000000-0000-4000-8000-000000000002" && Number.isInteger(payload.completedTaskRetentionDays) && (payload.completedTaskRetentionDays as number) >= 1 && (payload.completedTaskRetentionDays as number) <= 14;
    case "tasks":
      return hasOnlyKeys(payload, [...entityKeys, "title", "notes", "priority", "projectId", "sectionId", "tagIds", "sortKey", "dueDate", "dueTime", "dueTimeZone", "completedAt", "recurrence"]) &&
        nonEmptyText(payload.title) && text(payload.notes) && wirePriorities.includes(String(payload.priority)) &&
        textList(payload.tagIds) && payload.tagIds.every(value => uuid.test(value)) && finite(payload.sortKey) &&
        optionalDate(payload.dueDate) && optionalTime(payload.dueTime) &&
        [payload.projectId, payload.sectionId].every(optionalUuid) &&
        (payload.dueTimeZone === undefined || validTimeZone(payload.dueTimeZone)) &&
        optionalInstant(payload.completedAt) && (payload.recurrence === undefined || validRecurrence(payload.recurrence, true));
    case "projects": return hasOnlyKeys(payload, [...entityKeys, "name", "color", "sortKey", "archivedAt"]) &&
      nonEmptyText(payload.name) && nonEmptyText(payload.color) && finite(payload.sortKey) && optionalInstant(payload.archivedAt);
    case "sections": return hasOnlyKeys(payload, [...entityKeys, "projectId", "name", "sortKey"]) && uuid.test(String(payload.projectId)) && nonEmptyText(payload.name) && finite(payload.sortKey);
    case "tags": return hasOnlyKeys(payload, [...entityKeys, "name", "color"]) && nonEmptyText(payload.name) && text(payload.color);
    case "blocks": return hasOnlyKeys(payload, [...entityKeys, "taskId", "startInstant", "endInstant", "timeZone"]) &&
      uuid.test(String(payload.taskId)) && instant(payload.startInstant) && instant(payload.endInstant) &&
      Date.parse(payload.endInstant) > Date.parse(payload.startInstant) && validTimeZone(payload.timeZone);
    case "calendars": return hasOnlyKeys(payload, [...entityKeys, "name", "color", "visible", "sortKey"]) &&
      nonEmptyText(payload.name) && /^#[0-9a-f]{6}$/i.test(String(payload.color)) &&
      bool(payload.visible) && finite(payload.sortKey);
    case "calendarEvents": return hasOnlyKeys(payload, [...entityKeys, "calendarId", "title", "notes", "recurrence", "allDay", "startDate", "endDate", "startInstant", "endInstant", "timeZone"]) &&
      uuid.test(String(payload.calendarId)) && nonEmptyText(payload.title) && text(payload.notes) &&
      (payload.recurrence === undefined || validRecurrence(payload.recurrence, false)) &&
      (payload.allDay === true ? payload.startInstant === undefined && payload.endInstant === undefined && payload.timeZone === undefined &&
        dateOnly(payload.startDate) && dateOnly(payload.endDate) && payload.endDate > payload.startDate : payload.allDay === false &&
        payload.startDate === undefined && payload.endDate === undefined &&
        instant(payload.startInstant) && instant(payload.endInstant) && Date.parse(payload.endInstant) > Date.parse(payload.startInstant) && validTimeZone(payload.timeZone));
    case "taskTemplates": return hasOnlyKeys(payload, [...entityKeys, "name", "title", "notes", "priority", "projectId", "sectionId", "tagIds"]) &&
      nonEmptyText(payload.name) && nonEmptyText(payload.title) && text(payload.notes) &&
      wirePriorities.includes(String(payload.priority)) && textList(payload.tagIds) && payload.tagIds.every(value => uuid.test(value)) &&
      [payload.projectId, payload.sectionId].every(optionalUuid);
    case "eventTemplates": return hasOnlyKeys(payload, [...entityKeys, "name", "calendarId", "title", "notes", "allDay", "duration", "timeZone", "startTime"]) &&
      nonEmptyText(payload.name) && uuid.test(String(payload.calendarId)) && nonEmptyText(payload.title) &&
      text(payload.notes) && bool(payload.allDay) && Number.isSafeInteger(payload.duration) && (payload.duration as number) >= 1 &&
      (payload.allDay ? payload.timeZone === undefined && payload.startTime === undefined : validTimeZone(payload.timeZone) &&
        text(payload.startTime) && /^([01]\d|2[0-3]):[0-5]\d$/.test(payload.startTime));
    case "routines": return hasOnlyKeys(payload, [...entityKeys, "name", "templateId", "taskId", "enabled", "startDate", "recurrence"]) &&
      nonEmptyText(payload.name) && uuid.test(String(payload.templateId)) && uuid.test(String(payload.taskId)) &&
      bool(payload.enabled) && dateOnly(payload.startDate) && isRecord(payload.recurrence) &&
      validRecurrence(payload.recurrence, true);
    case "reminders": return hasOnlyKeys(payload, [...entityKeys, "taskId", "minutesBefore", "enabled"]) &&
      uuid.test(String(payload.taskId)) && Number.isSafeInteger(payload.minutesBefore) &&
      (payload.minutesBefore as number) >= 0 && bool(payload.enabled);
    case "savedViews": return hasOnlyKeys(payload, [...entityKeys, "name", "query", "projectId", "priority", "tagId", "dateScope", "completed"]) &&
      nonEmptyText(payload.name) && text(payload.query) &&
      (payload.projectId === undefined || payload.projectId === null || optionalUuid(payload.projectId)) &&
      (payload.tagId === undefined || optionalUuid(payload.tagId)) &&
      (payload.priority === undefined || payload.priority === "all" || wirePriorities.includes(String(payload.priority))) &&
      (payload.dateScope === undefined || ["all", "overdue", "today", "upcoming", "undated"].includes(String(payload.dateScope))) &&
      (payload.completed === undefined || payload.completed === "all" || bool(payload.completed));
  }
}

function failure(code: ProtocolFailure["code"], message: string): ProtocolFailure {
  return { ok: false, code, message };
}

function parseMutation(value: unknown): SyncMutation | undefined {
  if (!isRecord(value)) return;
  const operation = value.operation;
  const expectedKeys = operation === "upsert"
    ? ["entityType", "entityId", "baseRevision", "operation", "clientMutationId", "clientSchemaVersion", "payload"]
    : ["entityType", "entityId", "baseRevision", "operation", "clientMutationId", "clientSchemaVersion"];
  if (Object.keys(value).some(key => !expectedKeys.includes(key)) || expectedKeys.some(key => !(key in value))) return;
  if (typeof value.entityType !== "string" || !syncEntityTypes.includes(value.entityType as SyncEntityType) ||
      typeof value.entityId !== "string" || !uuid.test(value.entityId) ||
      !Number.isSafeInteger(value.baseRevision) || (value.baseRevision as number) < 0 ||
      (operation !== "upsert" && operation !== "delete") ||
      typeof value.clientMutationId !== "string" || !uuid.test(value.clientMutationId) ||
      value.clientSchemaVersion !== SYNC_CLIENT_SCHEMA_VERSION) return;
  if (operation === "delete") return value as SyncMutation;
  if (!isRecord(value.payload) || value.payload.id !== value.entityId || !safeJson(value.payload) ||
      !validEntityPayload(value.entityType as SyncEntityType, value.payload)) return;
  const payloadBytes = new TextEncoder().encode(JSON.stringify(value.payload)).byteLength;
  if (payloadBytes > MAX_SYNC_ENTITY_BYTES) return;
  return value as SyncMutation;
}

export function parseSyncPushBatch(value: unknown, serializedBytes?: number): ProtocolResult<SyncPushBatch> {
  if (serializedBytes !== undefined && serializedBytes > MAX_SYNC_BODY_BYTES) {
    return failure("request_too_large", "Sync request exceeds the maximum size");
  }
  if (!isRecord(value) || Object.keys(value).some(key => key !== "protocolVersion" && key !== "mutations") ||
      !Number.isSafeInteger(value.protocolVersion) || !Array.isArray(value.mutations)) {
    return failure("invalid_request", "Sync batch is malformed");
  }
  if (value.protocolVersion !== SYNC_PROTOCOL_VERSION) {
    return failure("unsupported_protocol", "This sync protocol version is not supported");
  }
  if (value.mutations.length > MAX_SYNC_BATCH) return failure("invalid_request", "Sync batch contains too many mutations");
  const mutations: SyncMutation[] = [];
  const mutationIds = new Set<string>();
  const entityIds = new Set<string>();
  for (const raw of value.mutations) {
    if (isRecord(raw) && raw.clientSchemaVersion !== SYNC_CLIENT_SCHEMA_VERSION) {
      return failure("unsupported_schema", "This entity schema version is not supported");
    }
    const mutation = parseMutation(raw);
    if (!mutation || mutationIds.has(mutation.clientMutationId)) {
      return failure("invalid_request", "Sync batch contains an invalid or repeated mutation");
    }
    const entityKey = `${mutation.entityType}:${mutation.entityId}`;
    if (entityIds.has(entityKey)) return failure("invalid_request", "A sync batch may change each entity only once");
    mutationIds.add(mutation.clientMutationId);
    entityIds.add(entityKey);
    mutations.push(mutation);
  }
  return { ok: true, value: { protocolVersion: SYNC_PROTOCOL_VERSION, mutations } };
}

export function parseSyncPullQuery(url: URL): ProtocolResult<{ cursor?: string; limit: number }> {
  const cursors = url.searchParams.getAll("cursor");
  const limits = url.searchParams.getAll("limit");
  if (cursors.length > 1 || limits.length > 1) return failure("invalid_request", "Sync query parameters must be unique");
  const cursor = cursors[0];
  if (cursor !== undefined && (!cursor || cursor.length > 1024 || !/^[A-Za-z0-9._~-]+$/.test(cursor))) {
    return failure("invalid_request", "Sync cursor is invalid");
  }
  const limit = limits.length ? Number(limits[0]) : 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SYNC_PAGE_SIZE) {
    return failure("invalid_request", `Sync page size must be between 1 and ${MAX_SYNC_PAGE_SIZE}`);
  }
  return { ok: true, value: { ...(cursor ? { cursor } : {}), limit } };
}
