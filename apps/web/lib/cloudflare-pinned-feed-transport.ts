import { resolve4, resolve6 } from "node:dns/promises";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { isPublicFeedAddress, type PinnedFeedTransport } from "./ics-fetch-security.ts";

const MAX_HEADER_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 512_000 + MAX_HEADER_BYTES;
const timeoutMs = 5_000;

export const cloudflareFeedResolver = {
  async resolve(hostname: string): Promise<string[]> {
    const [v4, v6] = await Promise.all([
      resolve4(hostname).catch(ignoreMissingFamily),
      resolve6(hostname).catch(ignoreMissingFamily)
    ]);
    return [...new Set([...v4, ...v6])];
  }
};

function ignoreMissingFamily(error: unknown): string[] {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (code === "ENODATA" || code === "ENOTFOUND" || code === "NODATA") return [];
  throw error;
}

/**
 * Cloudflare-backed HTTPS transport for untrusted ICS URLs. Each attempt connects to a literal,
 * prevalidated address; TLS still receives the original hostname for SNI and certificate checks.
 * Redirects are intentionally handled by fetchIcsFeed so every hop repeats DNS validation.
 */
export class CloudflarePinnedFeedTransport implements PinnedFeedTransport {
  async request(url: URL, pinnedAddresses: string[], options: { signal: AbortSignal; etag?: string; lastModified?: string }): Promise<Response> {
    if (url.protocol !== "https:" || url.port && url.port !== "443" || !url.hostname ||
        !pinnedAddresses.length || pinnedAddresses.some(address => !isIP(address) || !isPublicFeedAddress(address))) {
      throw new Error("Invalid pinned calendar destination");
    }
    let lastError: unknown;
    for (const address of pinnedAddresses) {
      try { return await this.requestAddress(url, address, options); }
      catch (error) {
        lastError = error;
        if (options.signal.aborted) break;
      }
    }
    throw lastError ?? new Error("No usable calendar destination");
  }

  private requestAddress(url: URL, address: string, options: { signal: AbortSignal; etag?: string; lastModified?: string }): Promise<Response> {
    return new Promise((resolve, reject) => {
      if (options.signal.aborted) { reject(new Error("Calendar request timed out")); return; }
      const socket = tlsConnect({ host: address, port: 443, servername: url.hostname,
        rejectUnauthorized: true, ALPNProtocols: ["http/1.1"] });
      const chunks: Uint8Array[] = [];
      let total = 0;
      let settled = false;
      let sent = false;
      const finish = (error?: unknown, response?: Response) => {
        if (settled) return;
        settled = true;
        options.signal.removeEventListener("abort", onAbort);
        socket.removeListener("secureConnect", onSecureConnect);
        socket.removeListener("data", onData);
        socket.removeListener("end", onEnd);
        socket.removeListener("error", onError);
        socket.removeListener("timeout", onTimeout);
        if (!socket.destroyed) socket.destroy();
        if (error) reject(error); else resolve(response!);
      };
      const onAbort = () => finish(new Error("Calendar request timed out"));
      const onTimeout = () => finish(new Error("Calendar request timed out"));
      const onError = (error: Error) => finish(error);
      const onData = (chunk: Uint8Array) => {
        total += chunk.byteLength;
        if (total > MAX_RESPONSE_BYTES) { finish(new Error("Calendar response is too large")); return; }
        chunks.push(new Uint8Array(chunk));
      };
      const onEnd = () => {
        try { finish(undefined, responseFromBytes(join(chunks, total))); }
        catch (error) { finish(error); }
      };
      const onSecureConnect = () => {
        // Fail closed if the runtime cannot prove the peer address or TLS certificate identity.
        if (!socket.authorized || !socket.remoteAddress || !sameAddress(socket.remoteAddress, address)) {
          finish(new Error("Pinned calendar connection could not be verified"));
          return;
        }
        if (sent) return;
        sent = true;
        socket.on("data", onData);
        socket.once("end", onEnd);
        socket.write(buildRequest(url, options), error => { if (error) onError(error); });
        socket.end();
      };

      options.signal.addEventListener("abort", onAbort, { once: true });
      socket.setTimeout(timeoutMs, onTimeout);
      socket.once("secureConnect", onSecureConnect);
      socket.once("error", onError);
    });
  }
}

function buildRequest(url: URL, options: { etag?: string; lastModified?: string }): string {
  const path = `${url.pathname || "/"}${url.search}`;
  const headers = [
    `GET ${path} HTTP/1.1`,
    `Host: ${url.hostname}`,
    "Accept: text/calendar, application/ics, application/octet-stream;q=0.8",
    "Accept-Encoding: identity",
    "Connection: close",
    "User-Agent: LTM-Todo-Calendar-Reader/1"
  ];
  const etag = safeValidator(options.etag);
  const modified = safeValidator(options.lastModified);
  if (etag) headers.push(`If-None-Match: ${etag}`);
  if (modified) headers.push(`If-Modified-Since: ${modified}`);
  return `${headers.join("\r\n")}\r\n\r\n`;
}

function safeValidator(value: string | undefined): string | undefined {
  return value && value.length <= 512 && !/[\u0000-\u001f\u007f]/.test(value) ? value : undefined;
}

export function responseFromBytes(raw: Uint8Array): Response {
  const headerEnd = findBytes(raw, [13, 10, 13, 10]);
  if (headerEnd < 0 || headerEnd > MAX_HEADER_BYTES) throw new Error("Calendar HTTP response headers are invalid");
  const headerText = new TextDecoder("ascii", { fatal: true }).decode(raw.subarray(0, headerEnd));
  const lines = headerText.split("\r\n");
  const status = lines.shift()?.match(/^HTTP\/1\.[01] ([1-5]\d\d)(?: [\x20-\x7e]*)?$/);
  if (!status) throw new Error("Calendar HTTP response status is invalid");
  const responseHeaders = new Headers();
  const headers = new Map<string, string[]>();
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0 || /^[ \t]/.test(line)) throw new Error("Calendar HTTP response header is invalid");
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)) {
      throw new Error("Calendar HTTP response header is invalid");
    }
    const values = headers.get(name) ?? [];
    values.push(value);
    headers.set(name, values);
  }
  const contentLengths = headers.get("content-length") ?? [];
  if (contentLengths.some(value => !/^\d+$/.test(value)) || new Set(contentLengths).size > 1) throw new Error("Calendar HTTP content length is invalid");
  const encodings = (headers.get("transfer-encoding") ?? []).join(",").toLowerCase();
  if (encodings && encodings !== "chunked") throw new Error("Calendar HTTP transfer encoding is unsupported");
  if (encodings && contentLengths.length) throw new Error("Calendar HTTP framing is ambiguous");
  const contentEncoding = (headers.get("content-encoding") ?? ["identity"]).join(",").toLowerCase();
  if (contentEncoding !== "identity") throw new Error("Compressed calendar responses are unsupported");
  for (const [name, values] of headers) {
    if (name === "set-cookie" || name === "connection" || name === "transfer-encoding" || name === "content-length" || name === "content-encoding") continue;
    for (const value of values) responseHeaders.append(name, value);
  }
  const bodyStart = headerEnd + 4;
  const encodedBody = raw.subarray(bodyStart);
  if ([204, 304].includes(Number(status[1]))) {
    if (encodedBody.byteLength) throw new Error("Calendar HTTP response unexpectedly contained a body");
    return new Response(null, { status: Number(status[1]), headers: responseHeaders });
  }
  let body = encodedBody;
  if (encodings === "chunked") body = decodeChunked(encodedBody);
  else if (contentLengths.length) {
    const expected = Number(contentLengths[0]);
    if (expected > 512_000 || encodedBody.byteLength !== expected) throw new Error("Calendar HTTP body length is invalid");
  }
  if (body.byteLength > 512_000) throw new Error("Calendar HTTP body is too large");
  const bodyBuffer = new ArrayBuffer(body.byteLength);
  new Uint8Array(bodyBuffer).set(body);
  return new Response(bodyBuffer, { status: Number(status[1]), headers: responseHeaders });
}

function decodeChunked(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let length = 0;
  while (true) {
    const lineEnd = findBytes(bytes, [13, 10], offset);
    if (lineEnd < 0 || lineEnd - offset > 128) throw new Error("Calendar chunk framing is invalid");
    const line = new TextDecoder("ascii").decode(bytes.subarray(offset, lineEnd));
    const sizeToken = line.split(";", 1)[0];
    if (!/^[0-9a-fA-F]{1,8}$/.test(sizeToken)) throw new Error("Calendar chunk size is invalid");
    const size = Number.parseInt(sizeToken, 16);
    offset = lineEnd + 2;
    if (size === 0) {
      if (offset + 2 <= bytes.length && bytes[offset] === 13 && bytes[offset + 1] === 10) {
        offset += 2;
      } else {
        const trailerEnd = findBytes(bytes, [13, 10, 13, 10], offset);
        if (trailerEnd < 0 || trailerEnd - offset > MAX_HEADER_BYTES) throw new Error("Calendar chunk trailers are invalid");
        const trailers = new TextDecoder("ascii", { fatal: true }).decode(bytes.subarray(offset, trailerEnd));
        for (const line of trailers.split("\r\n")) {
          const separator = line.indexOf(":");
          if (separator <= 0 || /^[ \t]/.test(line) || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(line.slice(0, separator)) ||
              /[\u0000-\u0008\u000a-\u001f\u007f]/.test(line.slice(separator + 1))) throw new Error("Calendar chunk trailers are invalid");
        }
        offset = trailerEnd + 4;
      }
      if (offset !== bytes.length) throw new Error("Calendar chunk framing contains trailing bytes");
      return join(chunks, length);
    }
    if (size > 512_000 || length + size > 512_000 || offset + size + 2 > bytes.length || bytes[offset + size] !== 13 || bytes[offset + size + 1] !== 10) {
      throw new Error("Calendar chunk body is invalid");
    }
    const chunk = bytes.subarray(offset, offset + size);
    chunks.push(chunk);
    length += size;
    offset += size + 2;
  }
}

function join(chunks: Uint8Array[], length: number): Uint8Array {
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function findBytes(haystack: Uint8Array, needle: number[], start = 0): number {
  outer: for (let index = start; index <= haystack.length - needle.length; index++) {
    for (let part = 0; part < needle.length; part++) if (haystack[index + part] !== needle[part]) continue outer;
    return index;
  }
  return -1;
}

function sameAddress(actual: string, expected: string): boolean {
  const strip = (value: string) => value.toLowerCase().replace(/^\[|\]$/g, "").replace(/^::ffff:/, "");
  return strip(actual) === strip(expected);
}
