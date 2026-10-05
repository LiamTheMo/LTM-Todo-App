type CursorPayload = { accountId: string; sequence: number; expiresAt: number };
type SnapshotCursorPayload = { accountId: string; sequence: number; entityType: string; entityId: string; expiresAt: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const fromBase64Url = (value: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid cursor");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

/** Encrypted, authenticated cursors are scoped to one account and contain no client-readable offsets. */
export class SyncCursorCodec {
  private readonly key: Promise<CryptoKey>;
  private readonly now: () => number;

  constructor(secretBase64Url: string, now: () => number = Date.now) {
    this.now = now;
    const secret = fromBase64Url(secretBase64Url);
    if (secret.byteLength !== 32) throw new Error("Sync cursor secret must be 32 bytes");
    this.key = crypto.subtle.importKey("raw", secret, "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  async encode(accountId: string, sequence: number, lifetimeMilliseconds = 90 * 86_400_000): Promise<string> {
    if (!accountId || !Number.isSafeInteger(sequence) || sequence < 0 || lifetimeMilliseconds < 60_000 || lifetimeMilliseconds > 180 * 86_400_000) {
      throw new Error("Invalid sync cursor state");
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload: CursorPayload = { accountId, sequence, expiresAt: this.now() + lifetimeMilliseconds };
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv,
      additionalData: encoder.encode("ltm-sync-cursor:v1") }, await this.key, encoder.encode(JSON.stringify(payload))));
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
    combined.set(iv);
    combined.set(encrypted, iv.byteLength);
    return `v1.${toBase64Url(combined)}`;
  }

  async decode(cursor: string, accountId: string): Promise<number> {
    if (!cursor.startsWith("v1.") || cursor.length > 1024) throw new Error("Invalid sync cursor");
    try {
      const combined = fromBase64Url(cursor.slice(3));
      if (combined.byteLength < 29) throw new Error("Invalid sync cursor");
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12),
        additionalData: encoder.encode("ltm-sync-cursor:v1") }, await this.key, combined.slice(12));
      const payload: unknown = JSON.parse(decoder.decode(plaintext));
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid sync cursor");
      const value = payload as Partial<CursorPayload>;
      if (value.accountId !== accountId || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0 ||
          !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= this.now()) throw new Error("Invalid sync cursor");
      return value.sequence as number;
    } catch { throw new Error("Invalid sync cursor"); }
  }

  async encodeSnapshot(value: Omit<SnapshotCursorPayload, "expiresAt">, lifetimeMilliseconds = 24 * 60 * 60_000): Promise<string> {
    if (!value.accountId || !Number.isSafeInteger(value.sequence) || value.sequence < 0 ||
        typeof value.entityType !== "string" || value.entityType.length > 32 ||
        typeof value.entityId !== "string" || value.entityId.length > 128 ||
        lifetimeMilliseconds < 60_000 || lifetimeMilliseconds > 7 * 86_400_000) throw new Error("Invalid snapshot cursor state");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload: SnapshotCursorPayload = { ...value, expiresAt: this.now() + lifetimeMilliseconds };
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv,
      additionalData: encoder.encode("ltm-sync-snapshot:v2") }, await this.key, encoder.encode(JSON.stringify(payload))));
    const combined = new Uint8Array(iv.byteLength + encrypted.byteLength);
    combined.set(iv);
    combined.set(encrypted, iv.byteLength);
    return `s2.${toBase64Url(combined)}`;
  }

  async decodeSnapshot(cursor: string, accountId: string): Promise<Omit<SnapshotCursorPayload, "expiresAt">> {
    if (!cursor.startsWith("s2.") || cursor.length > 1024) throw new Error("Invalid snapshot cursor");
    try {
      const combined = fromBase64Url(cursor.slice(3));
      if (combined.byteLength < 29) throw new Error("Invalid snapshot cursor");
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(0, 12),
        additionalData: encoder.encode("ltm-sync-snapshot:v2") }, await this.key, combined.slice(12));
      const payload: unknown = JSON.parse(decoder.decode(plaintext));
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid snapshot cursor");
      const value = payload as Partial<SnapshotCursorPayload>;
      if (value.accountId !== accountId || !Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0 ||
          typeof value.entityType !== "string" || value.entityType.length > 32 ||
          typeof value.entityId !== "string" || value.entityId.length > 128 ||
          !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= this.now()) throw new Error("Invalid snapshot cursor");
      return { accountId, sequence: value.sequence as number, entityType: value.entityType, entityId: value.entityId };
    } catch { throw new Error("Invalid snapshot cursor"); }
  }
}
