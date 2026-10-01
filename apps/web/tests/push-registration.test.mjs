import test from "node:test";
import assert from "node:assert/strict";
import { validatePushRegistration } from "../lib/push-registration.ts";

const registration = {
  token: "A".repeat(43),
  subscription: {
    endpoint: "https://web.push.apple.com/private-subscription-token",
    expirationTime: null,
    keys: { p256dh: "B".repeat(87), auth: "C".repeat(22) }
  }
};

test("accepts a standard iOS Web Push subscription from Apple's push service", () => {
  const result = validatePushRegistration(registration);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.subscription, registration.subscription);
});

test("normalizes an omitted expiration time to null", () => {
  const input = structuredClone(registration);
  delete input.subscription.expirationTime;
  const result = validatePushRegistration(input);
  assert.equal(result.ok, true);
  assert.equal(result.value.subscription.expirationTime, null);
});

test("returns a safe reason for rejected endpoint hosts without echoing the endpoint", () => {
  const input = structuredClone(registration);
  input.subscription.endpoint = "https://unknown.push-provider.example/private-token";
  const result = validatePushRegistration(input);
  assert.equal(result.ok, false);
  assert.match(result.error, /endpoint is unsupported/i);
  assert.doesNotMatch(result.error, /private-token|unknown\.push-provider/);
});

test("returns a safe reason when encryption keys are missing", () => {
  const input = structuredClone(registration);
  delete input.subscription.keys.auth;
  const result = validatePushRegistration(input);
  assert.equal(result.ok, false);
  assert.match(result.error, /encryption keys are missing or invalid/i);
});

test("returns a safe reason when the device token is invalid", () => {
  const input = { ...registration, token: "bad-token" };
  const result = validatePushRegistration(input);
  assert.equal(result.ok, false);
  assert.match(result.error, /device token is invalid/i);
});
