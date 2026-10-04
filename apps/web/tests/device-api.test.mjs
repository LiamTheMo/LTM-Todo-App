import test from "node:test";
import assert from "node:assert/strict";
import { handleDeviceRequest } from "../lib/device-api.ts";

const principal = { issuer: "https://issuer.test/", subject: "owner" };
const deviceId = "4e731b4e-c82c-4df6-a26a-847a2c115414";

function fixture(authenticated = true) {
  const calls = [];
  const auth = { async authenticate() { calls.push("authenticate"); return authenticated ? principal : undefined; } };
  const registry = {
    async list(user) { calls.push(["list", user]); return []; },
    async register(user, input) { calls.push(["register", user, input]); return { deviceId: input.deviceId }; },
    async acknowledge(user, id, cursor) { calls.push(["acknowledge", user, id, cursor]); return 7; },
    async retire(user, id) { calls.push(["retire", user, id]); return true; }
  };
  return { calls, auth, registry, request(path, method = "GET", body) {
    return new Request(`https://app.test${path}`, { method,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  } };
}

test("device collection requires authentication and registers bounded device descriptions", async () => {
  const anonymous = fixture(false);
  const response = await handleDeviceRequest(anonymous.request("/api/v1/devices", "POST", {
    deviceId, displayName: "This browser", clientKind: "web"
  }), anonymous.auth, anonymous.registry);
  assert.equal(response.status, 401);
  assert.deepEqual(anonymous.calls, ["authenticate"]);

  const f = fixture();
  const registered = await handleDeviceRequest(f.request("/api/v1/devices", "POST", {
    deviceId, displayName: "This browser", clientKind: "web"
  }), f.auth, f.registry);
  assert.equal(registered.status, 200);
  assert.deepEqual(f.calls[1][0], "register");
});

test("device cursor acknowledgements and retirement are scoped to a device route", async () => {
  const f = fixture();
  const ack = await handleDeviceRequest(f.request(`/api/v1/devices/${deviceId}/cursor`, "PUT", { cursor: "opaque" }), f.auth, f.registry);
  assert.equal(ack.status, 200);
  assert.deepEqual(await ack.json(), { acknowledgedSequence: 7 });
  const retired = await handleDeviceRequest(f.request(`/api/v1/devices/${deviceId}`, "DELETE"), f.auth, f.registry);
  assert.equal(retired.status, 200);
  assert.deepEqual(f.calls.filter(Array.isArray).map(call => call[0]), ["acknowledge", "retire"]);
});

test("device endpoints reject unsupported methods, malformed bodies, and unknown paths", async () => {
  const f = fixture();
  assert.equal((await handleDeviceRequest(f.request("/api/v1/devices", "DELETE"), f.auth, f.registry)).status, 405);
  assert.equal((await handleDeviceRequest(f.request("/api/v1/devices", "POST", { deviceId }), f.auth, f.registry)).status, 400);
  assert.equal((await handleDeviceRequest(f.request("/api/v1/devices/invalid", "DELETE"), f.auth, f.registry)).status, 404);
});
