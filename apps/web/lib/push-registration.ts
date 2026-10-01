export type PushSubscriptionRecord = {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
};

export type PushRegistration = {
  token: string;
  subscription: PushSubscriptionRecord;
};

type ValidationResult =
  | { ok: true; value: PushRegistration }
  | { ok: false; error: string };

const tokenPattern = /^[a-zA-Z0-9_-]{40,128}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function supportedEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4_096) return false;
  try {
    const endpoint = new URL(value);
    const host = endpoint.hostname.toLowerCase();
    const supportedHost = host === "fcm.googleapis.com" || host.endsWith(".push.apple.com") ||
      host.endsWith(".push.services.mozilla.com") || host.endsWith(".notify.windows.com");
    return endpoint.protocol === "https:" && !endpoint.username && !endpoint.password && supportedHost;
  } catch {
    return false;
  }
}

export function validatePushRegistration(value: unknown): ValidationResult {
  if (!isObject(value) || typeof value.token !== "string" || !tokenPattern.test(value.token)) {
    return { ok: false, error: "Invalid push registration: device token is invalid." };
  }

  const subscription = value.subscription;
  if (!isObject(subscription)) {
    return { ok: false, error: "Invalid push registration: browser subscription is missing." };
  }
  if (!supportedEndpoint(subscription.endpoint)) {
    return { ok: false, error: "Invalid push registration: push service endpoint is unsupported." };
  }
  if (subscription.expirationTime !== undefined && subscription.expirationTime !== null &&
    (typeof subscription.expirationTime !== "number" || !Number.isFinite(subscription.expirationTime))) {
    return { ok: false, error: "Invalid push registration: subscription expiration time is invalid." };
  }

  const keys = subscription.keys;
  if (!isObject(keys) || typeof keys.p256dh !== "string" || keys.p256dh.length === 0 || keys.p256dh.length > 256 ||
    typeof keys.auth !== "string" || keys.auth.length === 0 || keys.auth.length > 256) {
    return { ok: false, error: "Invalid push registration: subscription encryption keys are missing or invalid." };
  }

  return {
    ok: true,
    value: {
      token: value.token,
      subscription: {
        endpoint: subscription.endpoint,
        expirationTime: (subscription.expirationTime as number | null | undefined) ?? null,
        keys: { p256dh: keys.p256dh, auth: keys.auth }
      }
    }
  };
}
