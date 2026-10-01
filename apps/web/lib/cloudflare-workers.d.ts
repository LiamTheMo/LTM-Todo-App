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
  export const env: {
    DB: D1Database;
    VAPID_PUBLIC_KEY: string;
    VAPID_PRIVATE_KEY: string;
    VAPID_SUBJECT: string;
  };
}
