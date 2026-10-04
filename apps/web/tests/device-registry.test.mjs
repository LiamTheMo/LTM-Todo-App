import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DeviceRegistry, SyncDeviceError } from "../lib/device-registry.ts";
import { SyncCursorCodec } from "../lib/sync-cursor.ts";

function mockD1() {
  const db = new DatabaseSync(":memory:");
  return { db,
    prepare(sql) {
      let values = [];
      return { bind(...args) { values = args; return this; },
        first() { return db.prepare(sql).get(...values) ?? null; },
        all() { return { results: db.prepare(sql).all(...values) }; },
        run() { return db.prepare(sql).run(...values); }, _sql: sql, _values: () => values };
    },
    batch(statements) { db.exec("BEGIN"); try { for (const item of statements) db.prepare(item._sql).run(...item._values()); db.exec("COMMIT"); return Promise.resolve([]); }
      catch (error) { db.exec("ROLLBACK"); return Promise.reject(error); } }
  };
}

const first = { issuer: "https://issuer.test/", subject: "first" };
const second = { issuer: "https://issuer.test/", subject: "second" };
const deviceA = "4e731b4e-c82c-4df6-a26a-847a2c115414";
const deviceB = "9d45ce1b-8a74-4e97-a457-3a3878de0180";

async function setup() {
  const d1 = mockD1();
  for (const migration of ["0001_sync.sql", "0002_attachments.sql", "0003_attachment_reconciliation.sql", "0004_sessions_feeds_retention.sql", "0005_sync_retention_cursor.sql"]) {
    d1.db.exec(await readFile(resolve(import.meta.dirname, `../sync-migrations/${migration}`), "utf8"));
  }
  const codec = new SyncCursorCodec(Buffer.alloc(32, 21).toString("base64url"));
  return { d1, codec, registry: new DeviceRegistry(d1, codec) };
}

test("device registration and retirement are isolated to the authenticated account", async () => {
  const { d1, registry } = await setup();
  try {
    await registry.register(first, { deviceId: deviceA, displayName: "Phone", clientKind: "web" });
    await registry.register(second, { deviceId: deviceA, displayName: "Tablet", clientKind: "web" });
    assert.equal((await registry.list(first))[0].displayName, "Phone");
    assert.equal((await registry.list(second))[0].displayName, "Tablet");
    assert.equal(await registry.retire(first, deviceA), true);
    assert.equal((await registry.list(first))[0].retiredAt !== undefined, true);
    assert.equal((await registry.list(second))[0].retiredAt, undefined);
    await assert.rejects(() => registry.register(first, { deviceId: deviceA, displayName: "Phone", clientKind: "web" }),
      error => error instanceof SyncDeviceError && error.code === "device_retired");
  } finally { d1.db.close(); }
});

test("cursor acknowledgement is account-bound, monotonic, and unavailable to retired devices", async () => {
  const { d1, codec, registry } = await setup();
  try {
    await registry.register(first, { deviceId: deviceB, displayName: "Tablet", clientKind: "web" });
    const accountId = d1.db.prepare("SELECT account_id FROM sync_accounts WHERE issuer=? AND subject=?").get(first.issuer, first.subject).account_id;
    d1.db.prepare("UPDATE sync_accounts SET change_sequence=9 WHERE account_id=?").run(accountId);
    const atNine = await codec.encode(accountId, 9);
    const atEight = await codec.encode(accountId, 8);
    assert.equal(await registry.acknowledge(first, deviceB, atNine), 9);
    await assert.rejects(() => registry.acknowledge(first, deviceB, atEight),
      error => error instanceof SyncDeviceError && error.code === "cursor_regression");
    await assert.rejects(() => registry.acknowledge(second, deviceB, atNine),
      error => error instanceof SyncDeviceError && error.code === "invalid_cursor");
    await registry.retire(first, deviceB);
    await assert.rejects(() => registry.acknowledge(first, deviceB, atNine),
      error => error instanceof SyncDeviceError && error.code === "device_retired");
  } finally { d1.db.close(); }
});
