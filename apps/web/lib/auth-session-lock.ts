type LockManagerLike = {
  request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T>;
};

/**
 * Runs session checks one at a time across this origin's tabs. The session endpoint may redeem a rotating
 * refresh token, so a concurrent check must wait and then send the replacement cookie instead of the old token.
 */
export function withAuthSessionLock<T>(operation: () => Promise<T>, signal?: AbortSignal,
  locks: LockManagerLike | undefined = typeof navigator === "undefined" ? undefined : (navigator as { locks?: LockManagerLike }).locks): Promise<T> {
  return locks ? locks.request("ltm-auth-session", signal ? { signal } : {}, operation) : operation();
}

export function requestAuthSession(fetcher: typeof fetch = fetch, init: RequestInit = {}): Promise<Response> {
  return withAuthSessionLock(() => fetcher("/api/v1/auth/session", init), init.signal ?? undefined);
}
