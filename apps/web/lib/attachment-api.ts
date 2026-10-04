import { SyncRateLimitError, type SyncAuthenticator, type SyncPrincipal } from "./sync-api.ts";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"]);
export type AttachmentRecord = { id: string; taskId: string; fileName: string; mediaType: string; size: number; sha256: string; createdAt: string };
export type AttachmentStore = {
  list(principal: SyncPrincipal): Promise<AttachmentRecord[]>;
  upload(principal: SyncPrincipal, input: { uploadId: string; taskId: string; fileName: string; mediaType: string; bytes: Uint8Array; sha256: string }): Promise<AttachmentRecord>;
  download(principal: SyncPrincipal, id: string): Promise<{ metadata: AttachmentRecord; body: ReadableStream<Uint8Array> } | undefined>;
  remove(principal: SyncPrincipal, id: string): Promise<boolean>;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

function storeError(error: unknown): Response {
  return error instanceof SyncRateLimitError ? json({ error: "rate_limited" }, 429) : json({ error: "attachments_unavailable" }, 503);
}

export async function handleAttachmentRequest(request: Request, auth: SyncAuthenticator, store: AttachmentStore): Promise<Response> {
  const url = new URL(request.url);
  const collection = url.pathname === "/api/v1/attachments";
  const item = url.pathname.match(/^\/api\/v1\/attachments\/([0-9a-f-]{36})$/i);
  if (!collection && !item) return json({ error: "not_found" }, 404);
  let principal: SyncPrincipal | undefined;
  try { principal = await auth.authenticate(request); } catch { return json({ error: "authentication_unavailable" }, 503); }
  if (!principal?.issuer || !principal.subject) return json({ error: "unauthorized" }, 401);
  if (collection && request.method === "GET") {
    try { return json({ attachments: await store.list(principal) }); }
    catch (error) { return storeError(error); }
  }
  if (collection && request.method === "POST") return createAttachment(request, principal, store);
  if (item && request.method === "GET") {
    if (!UUID.test(item[1])) return json({ error: "invalid_request" }, 400);
    try {
      const result = await store.download(principal, item[1]);
      if (!result) return json({ error: "not_found" }, 404);
      return new Response(result.body, { headers: {
        "Content-Type": result.metadata.mediaType,
        "Content-Length": String(result.metadata.size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.metadata.fileName)}`,
        "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox"
      } });
    } catch (error) { return storeError(error); }
  }
  if (item && request.method === "DELETE") {
    if (!UUID.test(item[1])) return json({ error: "invalid_request" }, 400);
    try { const found = await store.remove(principal, item[1]); return json(found ? { deleted: true } : { error: "not_found" }, found ? 200 : 404); }
    catch (error) { return storeError(error); }
  }
  return json({ error: "method_not_allowed" }, 405);
}

async function createAttachment(request: Request, principal: SyncPrincipal, store: AttachmentStore): Promise<Response> {
  const mediaType = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() ?? "";
  const taskId = request.headers.get("X-LTM-Task-Id") ?? "";
  const uploadId = request.headers.get("Idempotency-Key") ?? "";
  const encodedFileName = request.headers.get("X-LTM-File-Name") ?? "";
  let decodedFileName = "";
  try { decodedFileName = decodeURIComponent(encodedFileName); } catch { return json({ error: "invalid_attachment" }, 400); }
  const fileName = safeFileName(decodedFileName);
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_ATTACHMENT_BYTES) {
    return json({ error: "attachment_too_large" }, 413);
  }
  if (!allowedTypes.has(mediaType) || !UUID.test(taskId) || !UUID.test(uploadId) || !fileName ||
      (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) < 1)) || !request.body) {
    return json({ error: "invalid_attachment" }, 400);
  }
  let bytes: Uint8Array | undefined;
  try { bytes = await readBody(request.body); }
  catch (error) { return json({ error: error instanceof AttachmentRequestError ? error.code : "invalid_attachment" }, error instanceof AttachmentRequestError ? error.status : 400); }
  if (!bytes || !bytes.byteLength) return json({ error: "invalid_attachment" }, 400);
  if (!matchesMediaType(bytes, mediaType)) return json({ error: "unsupported_file_content" }, 415);
  try {
    const digest = await crypto.subtle.digest("SHA-256", toBuffer(bytes));
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    const record = await store.upload(principal, { uploadId, taskId, fileName, mediaType, bytes, sha256 });
    return json({ attachment: record }, 201);
  } catch (error) {
    if (error instanceof SyncRateLimitError) return json({ error: "rate_limited" }, 429);
    return json({ error: error instanceof AttachmentRequestError ? error.code : "attachments_unavailable" },
      error instanceof AttachmentRequestError ? error.status : 503);
  }
}

export class AttachmentRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}

function safeFileName(value: string): string {
  const clean = value.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim().replace(/\s+/g, " ").slice(0, 120);
  return clean === "." || clean === ".." ? "" : clean;
}

async function readBody(stream: ReadableStream<Uint8Array>): Promise<Uint8Array | undefined> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_ATTACHMENT_BYTES) {
      try { await reader.cancel(); } catch { /* preserve the size failure */ }
      throw new AttachmentRequestError("attachment_too_large", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

function matchesMediaType(bytes: Uint8Array, type: string): boolean {
  if (type === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === "image/webp") return bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
  if (type === "application/pdf") return ascii(bytes, 0, 5) === "%PDF-";
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(content);
  } catch { return false; }
}

function ascii(bytes: Uint8Array, offset: number, count: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + count));
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
