const MAX_URL_CHARS = 2_048;
const MAX_REDIRECTS = 3;
const MAX_FEED_BYTES = 512_000;
const FETCH_TIMEOUT_MS = 5_000;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export type FeedResolver = { resolve(hostname: string): Promise<string[]> };
/** The implementation MUST connect to one of pinnedAddresses without resolving hostname again. */
export type PinnedFeedTransport = {
  request(url: URL, pinnedAddresses: string[], options: { signal: AbortSignal; etag?: string; lastModified?: string }): Promise<Response>;
};
export type FeedResponse = { status: 200 | 304; body?: string; etag?: string; lastModified?: string };

/** Validate the destination hostname before any network activity; IP literals are deliberately unsupported. */
export function validateIcsFeedUrl(input: string): URL {
  if (input.length > MAX_URL_CHARS) throw new Error("Calendar feed URL is too long");
  let url: URL;
  try { url = new URL(input); }
  catch { throw new Error("Calendar feed URL is invalid"); }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.port && url.port !== "443" || url.username || url.password || url.hash ||
      !hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
      hostname.endsWith(".internal") || hostname.startsWith("[") || /^[0-9.]+$/.test(hostname) || !hostname.includes(".")) {
    throw new Error("Calendar feed must use a public HTTPS hostname on port 443");
  }
  url.hostname = hostname;
  return url;
}

export function isPublicFeedAddress(address: string): boolean {
  if (address.includes("%")) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) {
    const octets = address.split(".").map(Number);
    if (octets.some(value => value > 255)) return false;
    const [a, b, c] = octets;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) || (a === 255));
  }
  const parsed = ipv6Number(address);
  if (parsed === undefined) return false;
  const globalUnicast = parsed >= 0x20000000000000000000000000000000n && parsed < 0x40000000000000000000000000000000n;
  const documentation = parsed >= 0x20010db8000000000000000000000000n && parsed < 0x20010dc0000000000000000000000000n;
  const teredo = parsed >= 0x20010000000000000000000000000000n && parsed < 0x20010001000000000000000000000000n;
  const sixToFour = parsed >= 0x20020000000000000000000000000000n && parsed < 0x20030000000000000000000000000000n;
  return globalUnicast && !documentation && !teredo && !sixToFour;
}

function ipv6Number(address: string): bigint | undefined {
  const source = address.toLowerCase();
  if (!source.includes(":") || source.startsWith("[") || source.endsWith("]") || source.includes(".")) return;
  const halves = source.split("::");
  if (halves.length > 2) return;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return;
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 2 && missing < 1)) return;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return;
  return groups.reduce((result, group) => result * 65_536n + BigInt(`0x${group}`), 0n);
}

/** Redirects and DNS are rechecked on every hop; only a connection-pinning transport can be supplied. */
export async function fetchIcsFeed(input: string, resolver: FeedResolver, transport: PinnedFeedTransport,
  options: { etag?: string; lastModified?: string } = {}): Promise<FeedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let url = validateIcsFeedUrl(input);
    const visited = new Set<string>();
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (visited.has(url.href)) throw new Error("Calendar feed redirect loop");
      visited.add(url.href);
      const addresses = await withAbort(resolver.resolve(url.hostname), controller.signal);
      if (!addresses.length || addresses.some(address => !isPublicFeedAddress(address))) throw new Error("Calendar feed resolves to a restricted destination");
      const response = await withAbort(transport.request(url, addresses, { signal: controller.signal,
        ...(hop === 0 ? { etag: options.etag, lastModified: options.lastModified } : {}) }), controller.signal);
      if (redirectStatuses.has(response.status)) {
        if (hop === MAX_REDIRECTS) throw new Error("Calendar feed has too many redirects");
        const location = response.headers.get("Location");
        if (!location) throw new Error("Calendar feed redirect is invalid");
        await response.body?.cancel();
        url = validateIcsFeedUrl(new URL(location, url).href);
        continue;
      }
      if (response.status === 304) return { status: 304, etag: response.headers.get("ETag") ?? options.etag,
        lastModified: response.headers.get("Last-Modified") ?? options.lastModified };
      if (!response.ok) throw new Error("Calendar feed could not be refreshed");
      const type = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
      if (type && !["text/calendar", "application/ics", "application/octet-stream"].includes(type)) throw new Error("Calendar feed returned an unsupported content type");
      const body = await readBoundedText(response);
      if (body === undefined) throw new Error("Calendar feed exceeds 512 KB or is not valid UTF-8");
      return { status: 200, body, etag: response.headers.get("ETag") ?? undefined,
        lastModified: response.headers.get("Last-Modified") ?? undefined };
    }
    throw new Error("Calendar feed could not be refreshed");
  } catch {
    throw new Error("Calendar feed could not be refreshed safely");
  } finally { clearTimeout(timer); }
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error("Timed out"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Timed out"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function readBoundedText(response: Response): Promise<string | undefined> {
  const declared = response.headers.get("Content-Length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_FEED_BYTES) || !response.body) return;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_FEED_BYTES) { await reader.cancel(); return; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return; }
}
