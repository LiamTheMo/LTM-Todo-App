import test from "node:test";
import assert from "node:assert/strict";
import { fetchIcsFeed, isPublicFeedAddress, validateIcsFeedUrl } from "../lib/ics-fetch-security.ts";
import { responseFromBytes } from "../lib/cloudflare-pinned-feed-transport.ts";

test("only public HTTPS DNS hostnames and globally routable addresses are accepted", () => {
  assert.equal(validateIcsFeedUrl("https://calendar.example.test/path?token=secret").protocol, "https:");
  for (const url of ["http://calendar.example.test/feed", "https://user:pass@calendar.example.test/feed",
    "https://127.0.0.1/feed", "https://[::1]/feed", "https://metadata.google.internal/feed", "https://calendar.example.test:8443/feed"]) {
    assert.throws(() => validateIcsFeedUrl(url));
  }
  for (const address of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.3", "100.64.0.1",
    "192.0.0.9", "192.88.99.10", "224.0.0.1", "2001:db8::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "not-an-address"]) {
    assert.equal(isPublicFeedAddress(address), false, address);
  }
  assert.equal(isPublicFeedAddress("93.184.216.34"), true);
  assert.equal(isPublicFeedAddress("2606:4700:4700::1111"), true);
});

test("pinned HTTP parser accepts bounded fixed and chunked feeds and rejects ambiguous framing", async () => {
  const bytes = value => new TextEncoder().encode(value);
  const fixed = responseFromBytes(bytes("HTTP/1.1 200 OK\r\nContent-Type: text/calendar\r\nContent-Length: 5\r\n\r\nhello"));
  assert.equal(await fixed.text(), "hello");
  const chunked = responseFromBytes(bytes("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\nX-Trace: ok\r\n\r\n"));
  assert.equal(await chunked.text(), "hello");
  assert.throws(() => responseFromBytes(bytes("HTTP/1.1 200 OK\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n")));
  assert.throws(() => responseFromBytes(bytes("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nextra")));
});

test("each redirect is revalidated and sent only with its public address set to the pinned transport", async () => {
  const resolutions = [];
  const requests = [];
  const resolver = { resolve: async hostname => { resolutions.push(hostname); return [hostname === "calendar.example.test" ? "93.184.216.34" : "2606:4700:4700::1111"]; } };
  const transport = { request: async (url, addresses) => {
    requests.push({ url: url.href, addresses });
    if (requests.length === 1) return new Response(null, { status: 302, headers: { Location: "https://feed.example.test/calendar.ics" } });
    return new Response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR", { headers: { "Content-Type": "text/calendar", ETag: '"v1"' } });
  } };
  const result = await fetchIcsFeed("https://calendar.example.test/feed", resolver, transport);
  assert.deepEqual(resolutions, ["calendar.example.test", "feed.example.test"]);
  assert.deepEqual(requests[0].addresses, ["93.184.216.34"]);
  assert.deepEqual(requests[1].addresses, ["2606:4700:4700::1111"]);
  assert.equal(result.status, 200);
  assert.equal(result.etag, '"v1"');
});

test("private resolutions, unsafe redirects, and large responses fail closed without exposing feed URLs", async () => {
  const transport = { request: async () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/internal" } }) };
  await assert.rejects(fetchIcsFeed("https://calendar.example.test/private", { resolve: async () => ["93.184.216.34", "10.0.0.4"] }, transport),
    error => error.message === "Calendar feed could not be refreshed safely" && !error.message.includes("private"));
  await assert.rejects(fetchIcsFeed("https://calendar.example.test/feed", { resolve: async () => ["93.184.216.34"] }, transport), /safely/);
  await assert.rejects(fetchIcsFeed("https://calendar.example.test/feed", { resolve: async () => ["93.184.216.34"] }, {
    request: async () => new Response("x", { headers: { "Content-Length": "900000", "Content-Type": "text/calendar" } })
  }), /safely/);
});
