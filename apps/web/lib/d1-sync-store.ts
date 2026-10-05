import { InvalidSyncCursorError, InvalidSyncRelationshipError, SyncMutationConflictError, SyncRateLimitError,
  type PullResponse, type PushResponse, type SyncChange, type SyncPrincipal, type SyncStore } from "./sync-api.ts";
import type { SyncEntityType, SyncMutation, SyncPushBatch } from "./sync-protocol.ts";
import { SyncCursorCodec } from "./sync-cursor.ts";
import { syncEntityOrderSql, syncEntityPriority } from "./sync-entity-order.ts";

type D1Statement = { bind(...values: unknown[]): D1Statement; first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>; run(): Promise<unknown> };
export type SyncD1Database = { prepare(query: string): D1Statement; batch(statements: D1Statement[]): Promise<unknown[]> };
type Account = { account_id: string; change_sequence: number; min_available_sequence?: number };
type Entity = { revision: number; payload: string | null; deleted_at: string | null; updated_at: string; updated_sequence?: number };
type Journal = { sequence: number; entity_type: string; entity_id: string; revision: number; payload: string | null; deleted_at: string | null; created_at: string };
type StoredMutation = PushResponse["results"][number];

export type SyncSnapshotResponse = {
  protocolVersion: 1;
  entitySchemaVersion: 4;
  changes: SyncChange[];
  complete: boolean;
  snapshotCursor?: string;
  cursor?: string;
};

function parsePayload(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  const result: unknown = JSON.parse(value);
  return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : null;
}
function change(type: string, id: string, row: Entity): SyncChange {
  return { entityType: type, entityId: id, revision: row.revision, updatedAt: row.updated_at,
    ...(row.deleted_at ? { deletedAt: row.deleted_at } : {}), ...(parsePayload(row.payload) ? { payload: parsePayload(row.payload)! } : {}) };
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
async function mutationHash(mutation: SyncMutation): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(mutation)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** D1 implementation. Calls must be serialized per principal by AccountSyncCoordinator. */
export class D1SyncStore implements SyncStore {
  private readonly db: SyncD1Database;
  private readonly cursors: SyncCursorCodec;
  private readonly requestsPerMinute: number;
  constructor(db: SyncD1Database, cursors: SyncCursorCodec, requestsPerMinute = 120) {
    this.db = db; this.cursors = cursors; this.requestsPerMinute = requestsPerMinute;
  }

  async push(principal: SyncPrincipal, batch: SyncPushBatch): Promise<PushResponse> {
    const account = await this.ensureAccount(principal);
    await this.rateLimit(account.account_id);
    let sequence = account.change_sequence;
    const writes: D1Statement[] = [];
    const results: StoredMutation[] = [];
    const working = new Map<string, Entity | null>();
    const key = (type: string, id: string) => `${type}:${id}`;

    for (const mutation of batch.mutations) {
      const requestHash = await mutationHash(mutation);
      const prior = await this.db.prepare("SELECT request_hash, response FROM sync_idempotency WHERE account_id=? AND client_mutation_id=?")
        .bind(account.account_id, mutation.clientMutationId).first<{ request_hash: string; response: string }>();
      if (prior) {
        if (prior.request_hash !== requestHash) throw new SyncMutationConflictError();
        results.push(JSON.parse(prior.response) as StoredMutation);
        continue;
      }

      const entityKey = key(mutation.entityType, mutation.entityId);
      let current = working.get(entityKey);
      if (current === undefined) current = await this.db.prepare("SELECT revision,payload,deleted_at,updated_at FROM sync_entities WHERE account_id=? AND entity_type=? AND entity_id=?")
        .bind(account.account_id, mutation.entityType, mutation.entityId).first<Entity>() ?? null;
      const revision = current?.revision ?? 0;
      let result: StoredMutation;
      if (revision !== mutation.baseRevision) {
        result = { clientMutationId: mutation.clientMutationId, status: "conflict", ...(current ? { current: change(mutation.entityType, mutation.entityId, current) } : {}) };
      } else {
        if (mutation.operation === "upsert") await this.validateRelationships(account.account_id, mutation, working);
        sequence += 1;
        const updatedAt = new Date().toISOString();
        const deletedAt = mutation.operation === "delete" ? updatedAt : null;
        const payload = mutation.operation === "upsert" ? mutation.payload! : null;
        const payloadText = payload ? JSON.stringify(payload) : null;
        const nextRevision = revision + 1;
        const next: Entity = { revision: nextRevision, payload: payloadText, deleted_at: deletedAt, updated_at: updatedAt };
        working.set(entityKey, next);
        writes.push(this.db.prepare(`INSERT INTO sync_entities(account_id,entity_type,entity_id,revision,client_schema_version,payload,deleted_at,updated_at,updated_sequence)
          VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,entity_type,entity_id) DO UPDATE SET revision=excluded.revision,
          client_schema_version=excluded.client_schema_version,payload=excluded.payload,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at,
          updated_sequence=excluded.updated_sequence`)
          .bind(account.account_id, mutation.entityType, mutation.entityId, nextRevision, mutation.clientSchemaVersion, payloadText, deletedAt, updatedAt, sequence));
        writes.push(this.db.prepare(`INSERT INTO sync_journal(account_id,sequence,entity_type,entity_id,revision,client_schema_version,payload,deleted_at,created_at)
          VALUES(?,?,?,?,?,?,?,?,?)`).bind(account.account_id, sequence, mutation.entityType, mutation.entityId,
          nextRevision, mutation.clientSchemaVersion, payloadText, deletedAt, updatedAt));
        result = { clientMutationId: mutation.clientMutationId, status: "accepted", revision: nextRevision,
          cursor: await this.cursors.encode(account.account_id, sequence) };
      }
      writes.push(this.db.prepare("INSERT INTO sync_idempotency(account_id,client_mutation_id,request_hash,response) VALUES(?,?,?,?)")
        .bind(account.account_id, mutation.clientMutationId, requestHash, JSON.stringify(result)));
      results.push(result);
    }
    writes.unshift(this.db.prepare("UPDATE sync_accounts SET change_sequence=?,last_seen_at=? WHERE account_id=?")
      .bind(sequence, new Date().toISOString(), account.account_id));
    await this.db.batch(writes);
    return { protocolVersion: 1, entitySchemaVersion: 4, results };
  }

  async pull(principal: SyncPrincipal, cursor: string | undefined, limit: number): Promise<PullResponse> {
    const account = await this.ensureAccount(principal);
    await this.rateLimit(account.account_id);
    let after = 0;
    if (cursor) {
      try { after = await this.cursors.decode(cursor, account.account_id); }
      catch { throw new InvalidSyncCursorError(); }
      if (after > account.change_sequence) throw new InvalidSyncCursorError();
    }
    const floor = account.min_available_sequence ?? (await this.db.prepare("SELECT min_available_sequence FROM sync_accounts WHERE account_id=?")
      .bind(account.account_id).first<{ min_available_sequence: number }>())?.min_available_sequence ?? 0;
    if (after < floor) throw new InvalidSyncCursorError();
    const page = await this.db.prepare(`SELECT sequence,entity_type,entity_id,revision,payload,deleted_at,created_at
      FROM sync_journal WHERE account_id=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?`)
      .bind(account.account_id, after, account.change_sequence, limit + 1).all<Journal>();
    const rows = page.results ?? [];
    const hasMore = rows.length > limit;
    const selected = hasMore ? rows.slice(0, limit) : rows;
    const changes = selected.map(row => change(row.entity_type, row.entity_id,
      { revision: row.revision, payload: row.payload, deleted_at: row.deleted_at, updated_at: row.created_at }));
    const next = hasMore && selected.length ? selected[selected.length - 1].sequence : account.change_sequence;
    return { protocolVersion: 1, entitySchemaVersion: 4, changes,
      cursor: await this.cursors.encode(account.account_id, next), hasMore };
  }

  /** Paged current-state snapshot lets new/expired devices recover after old journal rows are compacted. */
  async snapshot(principal: SyncPrincipal, snapshotCursor: string | undefined, limit: number): Promise<SyncSnapshotResponse> {
    const account = await this.ensureAccount(principal);
    await this.rateLimit(account.account_id);
    let sequence = account.change_sequence;
    let afterType = "";
    let afterId = "";
    let afterPriority = -1;
    if (snapshotCursor) {
      try {
        const state = await this.cursors.decodeSnapshot(snapshotCursor, account.account_id);
        sequence = state.sequence;
        afterType = state.entityType;
        afterId = state.entityId;
        afterPriority = syncEntityPriority[afterType];
        if (afterPriority === undefined) throw new InvalidSyncCursorError();
      } catch { throw new InvalidSyncCursorError(); }
      if (sequence > account.change_sequence) throw new InvalidSyncCursorError();
    }
    const page = await this.db.prepare(`SELECT entity_type,entity_id,revision,payload,deleted_at,updated_at,updated_sequence
      FROM sync_entities WHERE account_id=? AND updated_sequence<=? AND
      (${syncEntityOrderSql}>? OR (${syncEntityOrderSql}=? AND entity_id>?))
      ORDER BY ${syncEntityOrderSql},entity_id LIMIT ?`)
      .bind(account.account_id, sequence, afterPriority, afterPriority, afterId, limit + 1).all<{
        entity_type: string; entity_id: string; revision: number; payload: string | null; deleted_at: string | null;
        updated_at: string; updated_sequence: number;
      }>();
    const rows = page.results ?? [];
    const hasMore = rows.length > limit;
    const selected = hasMore ? rows.slice(0, limit) : rows;
    const changes = selected.map(row => change(row.entity_type, row.entity_id, {
      revision: row.revision, payload: row.payload, deleted_at: row.deleted_at, updated_at: row.updated_at,
      updated_sequence: row.updated_sequence
    }));
    if (hasMore && selected.length) {
      const last = selected[selected.length - 1];
      return { protocolVersion: 1, entitySchemaVersion: 4, changes, complete: false,
        snapshotCursor: await this.cursors.encodeSnapshot({ accountId: account.account_id, sequence,
          entityType: last.entity_type, entityId: last.entity_id }) };
    }
    return { protocolVersion: 1, entitySchemaVersion: 4, changes, complete: true,
      cursor: await this.cursors.encode(account.account_id, sequence) };
  }

  private async ensureAccount(principal: SyncPrincipal): Promise<Account> {
    await this.db.prepare(`INSERT INTO sync_accounts(account_id,issuer,subject) VALUES(?,?,?)
      ON CONFLICT(issuer,subject) DO UPDATE SET last_seen_at=excluded.last_seen_at`)
      .bind(crypto.randomUUID(), principal.issuer, principal.subject).run();
    const account = await this.db.prepare("SELECT account_id,change_sequence,min_available_sequence FROM sync_accounts WHERE issuer=? AND subject=?")
      .bind(principal.issuer, principal.subject).first<Account>();
    if (!account) throw new Error("Account lookup failed");
    await this.db.prepare("UPDATE sync_accounts SET last_seen_at=? WHERE account_id=?").bind(new Date().toISOString(), account.account_id).run();
    return account;
  }
  private async rateLimit(accountId: string) {
    const minute = new Date().toISOString().slice(0, 16);
    const row = await this.db.prepare(`INSERT INTO sync_rate_limits(account_id,window_start,request_count) VALUES(?,?,1)
      ON CONFLICT(account_id) DO UPDATE SET request_count=CASE WHEN window_start=excluded.window_start THEN request_count+1 ELSE 1 END,
      window_start=excluded.window_start RETURNING request_count`).bind(accountId, minute).first<{ request_count: number }>();
    if ((row?.request_count ?? this.requestsPerMinute + 1) > this.requestsPerMinute) throw new SyncRateLimitError();
  }
  private async find(accountId: string, type: SyncEntityType, id: string, working: Map<string, Entity | null>) {
    const cached = working.get(`${type}:${id}`);
    if (cached !== undefined) return cached && !cached.deleted_at ? cached : null;
    const row = await this.db.prepare(`SELECT revision,payload,deleted_at,updated_at FROM sync_entities
      WHERE account_id=? AND entity_type=? AND entity_id=? AND deleted_at IS NULL`).bind(accountId, type, id).first<Entity>();
    return row ?? null;
  }
  private async validateRelationships(accountId: string, mutation: SyncMutation, working: Map<string, Entity | null>) {
    const value = mutation.payload!;
    const required = async (field: string, type: SyncEntityType, optional = false) => {
      const id = value[field];
      if (optional && (id === undefined || id === null)) return null;
      if (typeof id !== "string" || !await this.find(accountId, type, id, working)) throw new InvalidSyncRelationshipError(`Missing or inaccessible ${field}`);
      return id;
    };
    switch (mutation.entityType) {
      case "tasks": {
        const projectId = await required("projectId", "projects", true);
        const sectionId = await required("sectionId", "sections", true);
        const parentId = await required("parentTaskId", "tasks", true);
        for (const id of value.tagIds as string[]) {
          if (typeof id !== "string" || !await this.find(accountId, "tags", id, working)) throw new InvalidSyncRelationshipError("Missing task tag");
        }
        if (sectionId) {
          const section = await this.find(accountId, "sections", sectionId, working);
          if (parsePayload(section?.payload ?? null)?.projectId !== projectId) throw new InvalidSyncRelationshipError("Section belongs to another project");
        }
        if (parentId) {
          const parent = await this.find(accountId, "tasks", parentId, working);
          const payload = parsePayload(parent?.payload ?? null);
          if (!payload || payload.parentTaskId || payload.projectId !== projectId || parentId === mutation.entityId) throw new InvalidSyncRelationshipError("Invalid parent task relationship");
        }
        break;
      }
      case "sections": await required("projectId", "projects"); break;
      case "blocks": case "reminders": case "completions": await required("taskId", "tasks"); break;
      case "calendarEvents": case "eventTemplates": await required("calendarId", "calendars"); break;
      case "taskTemplates": {
        const projectId = await required("projectId", "projects", true);
        const sectionId = await required("sectionId", "sections", true);
        for (const id of value.tagIds as string[]) {
          if (typeof id !== "string" || !await this.find(accountId, "tags", id, working)) throw new InvalidSyncRelationshipError("Missing task template tag");
        }
        if (sectionId && parsePayload((await this.find(accountId, "sections", sectionId, working))?.payload ?? null)?.projectId !== projectId) {
          throw new InvalidSyncRelationshipError("Section belongs to another project");
        }
        break;
      }
      case "routines": await required("templateId", "taskTemplates"); await required("taskId", "tasks"); break;
      case "savedViews": await required("projectId", "projects", true); await required("tagId", "tags", true); break;
    }
  }
}
