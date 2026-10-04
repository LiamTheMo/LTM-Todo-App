import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { D1IcsSubscriptionStore, handleIcsSubscriptionRequest } from "../lib/ics-subscriptions.ts";

function mockD1() {
  const db = new DatabaseSync(":memory:");
  return { db,
    prepare(sql) {
      let values = [];
      return { bind(...args) { values = args; return this; }, first() { return db.prepare(sql).get(...values) ?? null; },
        all() { return { results: db.prepare(sql).all(...values) }; }, run() { return db.prepare(sql).run(...values); },
        _sql: sql, _values: () => values };
    },
    batch(statements) { db.exec("BEGIN"); try { for (const item of statements) db.prepare(item._sql).run(...item._values()); db.exec("COMMIT"); return Promise.resolve([]); }
      catch (error) { db.exec("ROLLBACK"); return Promise.reject(error); } }
  };
}

const principal = { issuer: "https://identity.example.test/", subject: "alice" };
const otherPrincipal = { issuer: "https://identity.example.test/", subject: "bob" };
const calendarId = "de48da53-5ca6-4ef6-a4c5-b05f8863b74b";
const feed = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:team@example.test\r\nDTSTART:20261004T130000Z\r\nDTEND:20261004T140000Z\r\nSUMMARY:Team meeting\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

async function setup() {
  const d1 = mockD1();
  for (const migration of ["0001_sync.sql", "0002_attachments.sql", "0003_attachment_reconciliation.sql", "0004_sessions_feeds_retention.sql", "0005_sync_retention_cursor.sql"]) {
    d1.db.exec(await readFile(resolve(import.meta.dirname, `../sync-migrations/${migration}`), "utf8"));
  }
  let now = Date.parse("2026-10-04T00:00:00.000Z");
  const requests = [];
  const resolver = { resolve: async hostname => hostname === "calendar.example.test" ? ["93.184.216.34"] : ["2606:4700:4700::1111"] };
  const transport = { request: async (url, addresses, options) => {
    requests.push({ url: url.href, addresses, options });
    if (options.etag && requests.length > 1) return new Response(null, { status: 304, headers: { ETag: options.etag } });
    return new Response(feed, { headers: { "Content-Type": "text/calendar; charset=utf-8", ETag: '"v1"' } });
  } };
  const key = Buffer.alloc(32, 23).toString("base64url");
  const store = new D1IcsSubscriptionStore(d1, key, resolver, transport, () => now);
  const auth = { authenticate: async () => principal };
  const advance = milliseconds => { now += milliseconds; };
  return { d1, store, auth, requests, advance };
}

test("subscriptions encrypt the source URL, cache bounded read-only events, and stay account-scoped", async () => {
  const { d1, store, requests } = await setup();
  try {
    const subscription = await store.add(principal, { calendarId, name: "Work", color: "#123456",
      url: "https://calendar.example.test/team.ics?access_token=secret" });
    assert.equal(subscription.name, "Work");
    assert.equal(subscription.events.length, 1);
    assert.equal(subscription.events[0].title, "Team meeting");
    assert.equal(requests[0].addresses[0], "93.184.216.34");
    assert.equal(requests[0].url.includes("access_token=secret"), true);
    const row = d1.db.prepare("SELECT encrypted_url,cache_json FROM ics_subscriptions").get();
    assert.equal(row.encrypted_url.includes("calendar.example.test"), false);
    assert.equal(row.encrypted_url.includes("secret"), false);
    assert.equal((await store.list(principal))[0].events.length, 1);
    assert.deepEqual(await store.list(otherPrincipal), []);
    assert.equal(await store.remove(otherPrincipal, subscription.subscriptionId), false);
  } finally { d1.db.close(); }
});

test("same-origin subscription API validates inputs, updates feed metadata, and preserves cache on not-modified refresh", async () => {
  const { d1, store, auth, advance, requests } = await setup();
  try {
    const badUrl = await handleIcsSubscriptionRequest(new Request("https://app.example.test/api/v1/calendars/subscriptions", {
      method: "POST", headers: { Origin: "https://app.example.test", "Content-Type": "application/json" },
      body: JSON.stringify({ calendarId, name: "Work", color: "#123456", url: "http://127.0.0.1/private" })
    }), auth, store);
    assert.equal(badUrl.status, 400);

    const crossOrigin = await handleIcsSubscriptionRequest(new Request("https://app.example.test/api/v1/calendars/subscriptions", {
      method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
      body: JSON.stringify({ calendarId, name: "Work", color: "#123456", url: "https://calendar.example.test/team.ics" })
    }), auth, store);
    assert.equal(crossOrigin.status, 403);

    const created = await handleIcsSubscriptionRequest(new Request("https://app.example.test/api/v1/calendars/subscriptions", {
      method: "POST", headers: { Origin: "https://app.example.test", "Content-Type": "application/json" },
      body: JSON.stringify({ calendarId, name: "Work", color: "#123456", url: "https://calendar.example.test/team.ics" })
    }), auth, store);
    assert.equal(created.status, 201);
    const { subscription } = await created.json();
    advance(5 * 60_000);

    const changed = await handleIcsSubscriptionRequest(new Request(`https://app.example.test/api/v1/calendars/subscriptions/${subscription.subscriptionId}`, {
      method: "PATCH", headers: { Origin: "https://app.example.test", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Team", color: "#AABBCC", visible: false })
    }), auth, store);
    assert.equal(changed.status, 200);
    const updated = (await changed.json()).subscription;
    assert.equal(updated.name, "Team");
    assert.equal(updated.color, "#AABBCC");
    assert.equal(updated.visible, false);

    const refreshed = await handleIcsSubscriptionRequest(new Request(`https://app.example.test/api/v1/calendars/subscriptions/${subscription.subscriptionId}/refresh`, {
      method: "POST", headers: { Origin: "https://app.example.test" }
    }), auth, store);
    assert.equal(refreshed.status, 200);
    const refreshResult = (await refreshed.json()).subscription;
    assert.equal(refreshResult.events.length, 1);
    assert.equal(requests[1].options.etag, '"v1"');

    const removed = await handleIcsSubscriptionRequest(new Request(`https://app.example.test/api/v1/calendars/subscriptions/${subscription.subscriptionId}`, {
      method: "DELETE", headers: { Origin: "https://app.example.test" }
    }), auth, store);
    assert.equal(removed.status, 200);
    assert.deepEqual(await store.list(principal), []);
  } finally { d1.db.close(); }
});

test("manual feed refreshes are rate-limited and invalid cache rows fail closed", async () => {
  const { d1, store, advance } = await setup();
  try {
    const subscription = await store.add(principal, { calendarId, name: "Work", color: "#123456", url: "https://calendar.example.test/team.ics" });
    await assert.rejects(store.refresh(principal, subscription.subscriptionId), /refresh_throttled/);
    advance(5 * 60_001);
    await store.refresh(principal, subscription.subscriptionId);
    d1.db.prepare("UPDATE ics_subscriptions SET cache_json='[null,{}, {\"uid\":\"u\",\"recurrenceId\":\"r\",\"title\":\"ok\",\"start\":\"bad\",\"end\":\"also-bad\",\"allDay\":false}]'").run();
    assert.deepEqual((await store.list(principal))[0].events, []);
  } finally { d1.db.close(); }
});
