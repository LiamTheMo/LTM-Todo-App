export type EdgeRateLimitBinding = { limit(options: { key: string }): Promise<{ success: boolean }> };

/** Applies Cloudflare's per-location edge limiter without logging or persisting the source IP. */
export async function enforceEdgeRateLimit(
  request: Request,
  binding: EdgeRateLimitBinding,
  scope: "sync" | "auth"
): Promise<Response | undefined> {
  const sourceIp = request.headers.get("CF-Connecting-IP");
  if (!sourceIp || sourceIp.length > 128 || /[\r\n\0]/.test(sourceIp)) return unavailable();
  try {
    const result = await binding.limit({ key: `ltm-v3:${scope}:${sourceIp}` });
    return result.success ? undefined : Response.json({ error: "rate_limited" }, {
      status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "60" }
    });
  } catch {
    return unavailable();
  }
}

function unavailable(): Response {
  return Response.json({ error: "service_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
