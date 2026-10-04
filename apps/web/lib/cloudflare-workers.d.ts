declare module "cloudflare:workers" {
  type D1Result<T> = { results?: T[] };
  type D1PreparedStatement = {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    run(): Promise<unknown>;
    all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  };
  type D1Database = {
    prepare(query: string): D1PreparedStatement;
    batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
  };
  type R2Bucket = {
    put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
    get(key: string): Promise<{ body: ReadableStream<Uint8Array> } | null>;
    delete(key: string): Promise<void>;
    list(options?: { limit?: number; cursor?: string; prefix?: string }): Promise<{ objects: Array<{ key: string; uploaded: Date }>; truncated: boolean; cursor?: string }>;
  };
  export const env: {
    DB: D1Database;
    SYNC_DB: D1Database;
    SYNC_COORDINATOR: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } };
    VAPID_PUBLIC_KEY: string;
    VAPID_PRIVATE_KEY: string;
    VAPID_SUBJECT: string;
    OIDC_ISSUER?: string;
    OIDC_AUDIENCE?: string;
    OIDC_JWKS_URI?: string;
    OIDC_CLIENT_ID?: string;
    OIDC_CLIENT_SECRET?: string;
    OIDC_REDIRECT_URI?: string;
    AUTH_SESSION_SECRET?: string;
    SYNC_EDGE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
    AUTH_EDGE_LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
    SYNC_CURSOR_SECRET?: string;
    ICS_FEED_ENCRYPTION_KEY?: string;
    ATTACHMENTS_BUCKET?: R2Bucket;
  };
}
