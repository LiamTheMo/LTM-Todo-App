export type AccountSignInStatus = "checking" | "signed_in" | "signed_out" | "unavailable";

export async function readAccountSignInStatus(fetcher: typeof fetch = fetch): Promise<AccountSignInStatus> {
  try {
    const response = await fetcher("/api/v1/auth/session", { cache: "no-store", credentials: "same-origin" });
    if (response.status === 401) return "signed_out";
    if (!response.ok) return "unavailable";
    const session = await response.json() as { authenticated?: unknown };
    if (session.authenticated === true) return "signed_in";
    if (session.authenticated === false) return "signed_out";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}
