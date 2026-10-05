import { SyncDeviceError, type DeviceRegistry } from "./device-registry.ts";
import type { SyncAuthenticator } from "./sync-api.ts";
import { logSyncBackendFailure } from "./sync-diagnostics.ts";

const maxBodyBytes = 4_096;
const deviceIdPath = /^\/api\/v1\/devices\/([0-9a-f-]{36})$/i;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "Vary": "Cookie, Authorization" } });
}

/** Authenticated same-origin API for registering, inspecting, acknowledging, and retiring sync devices. */
export async function handleDeviceRequest(request: Request, auth: SyncAuthenticator, registry: DeviceRegistry): Promise<Response> {
  const url = new URL(request.url);
  const collection = url.pathname === "/api/v1/devices";
  const item = url.pathname.match(deviceIdPath);
  const cursor = url.pathname.match(/^\/api\/v1\/devices\/([0-9a-f-]{36})\/cursor$/i);
  if (!collection && !item && !cursor) return json({ error: "not_found" }, 404);
  const methodAllowed = collection ? ["GET", "POST"].includes(request.method) : item ? request.method === "DELETE" : request.method === "PUT";
  if (!methodAllowed) return json({ error: "method_not_allowed" }, 405);

  let principal;
  try { principal = await auth.authenticate(request); }
  catch (error) { const code = logSyncBackendFailure("device_authentication", error);
    return json({ error: code === "sync_unavailable" ? "authentication_unavailable" : code }, 503); }
  if (!principal) return json({ error: "unauthorized" }, 401);

  try {
    if (request.method === "GET") return json({ devices: await registry.list(principal) });
    if (request.method === "DELETE") {
      const retired = await registry.retire(principal, item![1]);
      return retired ? json({ retired: true }) : json({ error: "device_not_found" }, 404);
    }
    const body = await readBody(request);
    if (!body) return json({ error: "invalid_request" }, 400);
    if (request.method === "POST") {
      if (typeof body.deviceId !== "string" || typeof body.displayName !== "string" ||
          (body.clientKind !== "web" && body.clientKind !== "apple")) return json({ error: "invalid_device" }, 400);
      const device = await registry.register(principal, { deviceId: body.deviceId, displayName: body.displayName, clientKind: body.clientKind });
      return json({ device }, 200);
    }
    if (typeof body.cursor !== "string") return json({ error: "invalid_cursor" }, 400);
    const sequence = await registry.acknowledge(principal, cursor![1], body.cursor);
    return json({ acknowledgedSequence: sequence });
  } catch (error) {
    if (error instanceof SyncDeviceError) {
      const status = error.code === "invalid_device" || error.code === "invalid_cursor" ? 400 :
        error.code === "device_retired" ? 410 : 409;
      return json({ error: error.code }, status);
    }
    const code = logSyncBackendFailure("device_registration", error);
    return json({ error: code === "sync_unavailable" ? "devices_unavailable" : code }, 503);
  }
}

async function readBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const declared = request.headers.get("Content-Length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBodyBytes) ||
      !request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json") || !request.body) return;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBodyBytes) { await reader.cancel(); return; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch { return; }
}
