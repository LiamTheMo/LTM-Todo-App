import { env } from "cloudflare:workers";
import { validatePushRegistration, type PushSubscriptionRecord } from "./push-registration";

export type ScheduledReminder = {
  id: string;
  title: string;
  triggerAt: number;
};

const encoder = new TextEncoder();
const MAX_REMINDERS = 5_000;
const MAX_BODY_BYTES = 4_000_000;

class RequestTooLargeError extends Error {}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
}

async function readJson(request: Request) {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new RequestTooLargeError("Request is too large");
  if (!request.body) throw new Error("Request body is empty");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RequestTooLargeError("Request is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function authorizedDevice(request: Request) {
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || token.length < 40 || token.length > 128) return;
  const tokenHash = await sha256(token);
  const device = await env.DB.prepare("SELECT token_hash FROM push_devices WHERE token_hash = ?")
    .bind(tokenHash).first<{ token_hash: string }>();
  return device ? tokenHash : undefined;
}

export async function handleNotificationRequest(request: Request) {
  const path = new URL(request.url).pathname;
  if (request.method === "POST" && path === "/api/notifications/test") {
    if (!isSameOrigin(request)) return json({ error: "Cross-origin requests are not allowed" }, 403);
    const tokenHash = await authorizedDevice(request);
    if (!tokenHash) return json({ error: "Push device is not registered" }, 401);
    const device = await env.DB.prepare("SELECT subscription_json FROM push_devices WHERE token_hash = ?")
      .bind(tokenHash).first<{ subscription_json: string }>();
    if (!device || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
      return json({ error: "Push notifications are not configured for this device" }, 503);
    }
    try {
      const { buildPushPayload } = await import("@block65/webcrypto-web-push");
      const subscription = JSON.parse(device.subscription_json) as PushSubscriptionRecord;
      const payload = await buildPushPayload({ data: JSON.stringify({ title: "LTM Todo test", reminderId: "test" }) }, subscription, {
        subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY
      });
      const result = await fetch(subscription.endpoint, payload);
      if (result.status === 404 || result.status === 410) {
        await env.DB.prepare("DELETE FROM push_devices WHERE token_hash = ?").bind(tokenHash).run();
        return json({ error: "This device subscription expired. Enable notifications again." }, 410);
      }
      return result.ok ? json({ ok: true }) : json({ error: "The push service rejected the test notification" }, 502);
    } catch { return json({ error: "The test notification could not be sent" }, 502); }
  }
  if (request.method === "GET" && path === "/api/notifications/config") {
    const enabled = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT && env.DB);
    return json({ enabled, publicKey: enabled ? env.VAPID_PUBLIC_KEY : null });
  }
  if (!isSameOrigin(request)) return json({ error: "Cross-origin requests are not allowed" }, 403);
  if (request.method === "POST" && path === "/api/notifications/register") {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT || !env.DB) return json({ error: "Push notifications are not configured yet" }, 503);
    let input: unknown;
    try { input = await readJson(request); } catch (cause) { return json({ error: cause instanceof RequestTooLargeError ? "Request is too large" : "Invalid request body" }, cause instanceof RequestTooLargeError ? 413 : 400); }
    const validation = validatePushRegistration(input);
    if (!validation.ok) return json({ error: validation.error }, 400);
    const record = validation.value;
    const tokenHash = await sha256(record.token);
    const endpointHash = await sha256(record.subscription.endpoint);
    const prior = await env.DB.prepare("SELECT token_hash FROM push_devices WHERE token_hash = ?")
      .bind(tokenHash).first<{ token_hash: string }>();
    const endpointOwner = await env.DB.prepare("SELECT token_hash FROM push_devices WHERE endpoint_hash = ?")
      .bind(endpointHash).first<{ token_hash: string }>();
    if (!prior) {
      const ip = request.headers.get("CF-Connecting-IP");
      if (!ip) return json({ error: "Registration could not be verified" }, 400);
      const ipHash = await sha256(ip);
      const now = Date.now();
      const hour = Math.floor(now / 3_600_000) * 3_600_000;
      const rate = await env.DB.prepare(`INSERT INTO push_registration_limits (ip_hash, hour_start, registrations)
        VALUES (?, ?, 1) ON CONFLICT(ip_hash) DO UPDATE SET
          registrations = CASE WHEN push_registration_limits.hour_start = excluded.hour_start THEN push_registration_limits.registrations + 1 ELSE 1 END,
          hour_start = excluded.hour_start RETURNING registrations`).bind(ipHash, hour)
        .first<{ registrations: number }>();
      if ((rate?.registrations ?? 99) > 10) return json({ error: "Too many notification devices registered from this network" }, 429);
    }
    const now = Date.now();
    const registrationStatements = [];
    if (endpointOwner && endpointOwner.token_hash !== tokenHash) {
      registrationStatements.push(
        env.DB.prepare("DELETE FROM push_reminders WHERE token_hash = ?").bind(endpointOwner.token_hash),
        env.DB.prepare("DELETE FROM push_devices WHERE token_hash = ?").bind(endpointOwner.token_hash)
      );
    }
    registrationStatements.push(env.DB.prepare(`INSERT INTO push_devices (token_hash, endpoint_hash, subscription_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(token_hash) DO UPDATE SET endpoint_hash = excluded.endpoint_hash,
      subscription_json = excluded.subscription_json, updated_at = excluded.updated_at`)
      .bind(tokenHash, endpointHash, JSON.stringify(record.subscription), now, now));
    await env.DB.batch(registrationStatements);
    return json({ ok: true });
  }
  if (request.method === "POST" && path === "/api/notifications/schedules") {
    if (!isSameOrigin(request)) return json({ error: "Cross-origin requests are not allowed" }, 403);
    const tokenHash = await authorizedDevice(request);
    if (!tokenHash) return json({ error: "Push device is not registered" }, 401);
    let input: unknown;
    try { input = await readJson(request); } catch (cause) { return json({ error: cause instanceof RequestTooLargeError ? "Request is too large" : "Invalid request body" }, cause instanceof RequestTooLargeError ? 413 : 400); }
    const reminders = (input as { reminders?: unknown })?.reminders;
    const reminderIds = Array.isArray(reminders) ? new Set(reminders.map(item => (item as Partial<ScheduledReminder>)?.id)) : new Set();
    if (!Array.isArray(reminders) || reminders.length > MAX_REMINDERS || reminders.some(item => {
      const reminder = item as Partial<ScheduledReminder>;
      return typeof reminder?.id !== "string" || reminder.id.length > 128 ||
        typeof reminder.title !== "string" || !reminder.title.trim() || reminder.title.length > 500 ||
        !Number.isSafeInteger(reminder.triggerAt) || (reminder.triggerAt as number) < Date.now() - 60_000 ||
        (reminder.triggerAt as number) > 8_640_000_000_000_000;
    }) || reminderIds.size !== reminders.length) return json({ error: `Reminder schedules must contain at most ${MAX_REMINDERS} unique valid items` }, 400);

    const now = Date.now();
    const statements = [
      env.DB.prepare("UPDATE push_devices SET updated_at = ? WHERE token_hash = ?").bind(now, tokenHash),
      env.DB.prepare("DELETE FROM push_reminders WHERE token_hash = ?").bind(tokenHash)
    ];
    for (let offset = 0; offset < reminders.length; offset += 52) {
      const chunk = reminders.slice(offset, offset + 52) as ScheduledReminder[];
      const values = chunk.map(() => "(?, ?, ?, ?, ?, 0, NULL, NULL)").join(",");
      const params = chunk.flatMap(reminder => [tokenHash, reminder.id, reminder.title.trim(), reminder.triggerAt, now]);
      statements.push(env.DB.prepare(`INSERT INTO push_reminders
        (token_hash, reminder_id, title, trigger_at, updated_at, attempts, sent_at, locked_until)
        VALUES ${values}`).bind(...params));
    }
    try { await env.DB.batch(statements); }
    catch { return json({ error: "Reminder schedules could not be saved" }, 503); }
    return json({ ok: true, scheduled: reminders.length, syncedAt: now });
  }
  if (request.method === "DELETE" && path === "/api/notifications/register") {
    const tokenHash = await authorizedDevice(request);
    if (!tokenHash) return json({ error: "Push device is not registered" }, 401);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM push_reminders WHERE token_hash = ?").bind(tokenHash),
      env.DB.prepare("DELETE FROM push_devices WHERE token_hash = ?").bind(tokenHash)
    ]);
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}

export async function dispatchDueNotifications(now = Date.now()) {
  if (!env.DB || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
    return;
  }
  const claimed = await env.DB.prepare(`UPDATE push_reminders
      SET locked_until = ?, attempts = attempts + 1
      WHERE rowid IN (
        SELECT r.rowid FROM push_reminders r
        WHERE r.sent_at IS NULL AND r.trigger_at <= ? AND (r.locked_until IS NULL OR r.locked_until < ?)
          AND r.attempts < 5
        ORDER BY r.trigger_at LIMIT 25
      )
      RETURNING token_hash, reminder_id, title, trigger_at, attempts`)
    .bind(now + 2 * 60_000, now, now).all<{
      token_hash: string; reminder_id: string; title: string; trigger_at: number; attempts: number;
    }>();
  const rows = claimed.results ?? [];
  for (const reminder of rows) {
    const device = await env.DB.prepare("SELECT subscription_json FROM push_devices WHERE token_hash = ?")
      .bind(reminder.token_hash).first<{ subscription_json: string }>();
    if (!device) {
      await env.DB.prepare("DELETE FROM push_reminders WHERE token_hash = ? AND reminder_id = ?")
        .bind(reminder.token_hash, reminder.reminder_id).run();
      continue;
    }
    try {
      const { buildPushPayload } = await import("@block65/webcrypto-web-push");
      const subscription = JSON.parse(device.subscription_json) as PushSubscriptionRecord;
      const payload = await buildPushPayload({ data: JSON.stringify({ title: reminder.title, reminderId: reminder.reminder_id }), options: { ttl: 86_400, urgency: "high" } }, subscription, {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY
      });
      const response = await fetch(subscription.endpoint, payload);
      if (response.status === 404 || response.status === 410) {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM push_reminders WHERE token_hash = ?").bind(reminder.token_hash),
          env.DB.prepare("DELETE FROM push_devices WHERE token_hash = ?").bind(reminder.token_hash)
        ]);
      } else if (response.ok) {
        await env.DB.prepare("UPDATE push_reminders SET sent_at = ?, locked_until = NULL WHERE token_hash = ? AND reminder_id = ?")
          .bind(now, reminder.token_hash, reminder.reminder_id).run();
      } else if (reminder.attempts >= 5) {
        console.warn("Web Push delivery abandoned after repeated service rejection", { status: response.status, attempts: reminder.attempts });
        await env.DB.prepare("DELETE FROM push_reminders WHERE token_hash = ? AND reminder_id = ?")
          .bind(reminder.token_hash, reminder.reminder_id).run();
      } else {
        console.warn("Web Push service rejected a delivery; it will be retried", { status: response.status, attempts: reminder.attempts });
        await env.DB.prepare("UPDATE push_reminders SET locked_until = NULL WHERE token_hash = ? AND reminder_id = ?")
          .bind(reminder.token_hash, reminder.reminder_id).run();
      }
    } catch {
      if (reminder.attempts >= 5) {
        console.warn("Web Push delivery abandoned after repeated sender errors", { attempts: reminder.attempts });
        await env.DB.prepare("DELETE FROM push_reminders WHERE token_hash = ? AND reminder_id = ?")
          .bind(reminder.token_hash, reminder.reminder_id).run();
      } else {
        console.warn("Web Push sender failed; it will be retried", { attempts: reminder.attempts });
        await env.DB.prepare("UPDATE push_reminders SET locked_until = NULL WHERE token_hash = ? AND reminder_id = ?")
          .bind(reminder.token_hash, reminder.reminder_id).run();
      }
    }
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM push_reminders WHERE sent_at < ?").bind(now - 30 * 86_400_000),
    env.DB.prepare("DELETE FROM push_devices WHERE updated_at < ?").bind(now - 180 * 86_400_000),
    env.DB.prepare("DELETE FROM push_registration_limits WHERE hour_start < ?").bind(now - 2 * 3_600_000)
  ]);
}
