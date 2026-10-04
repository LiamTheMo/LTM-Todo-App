# Cloudflare Worker deployment

The web client is deployed to Cloudflare Workers as `ltm-todo-app` using Cloudflare Workers Builds.

## Production policy

Connect the GitHub repository to the existing Worker and set `main` as the production branch. Disable preview builds so pushes to version and temporary branches do not deploy. Cloudflare builds and deploys when a commit reaches `main`; GitHub Actions does not deploy. Protect `main` with a pull request requirement and require the version-branch CI checks before merging.

## Workers Builds settings

- Repository: `OrangeCheasy/LTM-Todo-App`
- Production branch: `main`
- Root directory: `apps/web`
- Build command: `npm run build:vinext`
- Deploy command: `npm run deploy:worker`
- Preview builds: disabled

Workers Builds installs dependencies automatically. Its API token must be allowed to edit Workers Scripts and D1 databases. Keep the token in Cloudflare's build settings; never put it in the repository.

Add these production-only entries under **Settings → Builds → Build variables and secrets**. Database IDs may be build variables; all runtime values must be build secrets so the deployment command can install them as Worker secrets:

- `D1_DATABASE_ID` — the UUID of the production D1 database. It is a database identifier, not an access credential, but this public repository keeps it out of Git by injecting it into temporary Wrangler config files during deployment.
- `SYNC_D1_DATABASE_ID` — the UUID of the separate account-sync D1 database.
- `VAPID_PRIVATE_KEY` — the private half of the dedicated Web Push VAPID key pair.
- `OIDC_ISSUER` and `OIDC_JWKS_URI` — copy the exact `issuer` and `jwks_uri` values from the provider's `/.well-known/openid-configuration` document. `OIDC_AUDIENCE` — the API/resource identifier expected in access-token `aud`; the app sends it as the authorization `audience` parameter for providers that support that convention, including Auth0. `OIDC_CLIENT_ID` — the registered app's client ID. `OIDC_REDIRECT_URI` — the exact callback `<app-origin>/api/v1/auth/callback` registered with the provider.
- `OIDC_CLIENT_SECRET` — optional; only needed for a confidential OIDC client.
- `AUTH_SESSION_SECRET`, `SYNC_CURSOR_SECRET`, and `ICS_FEED_ENCRYPTION_KEY` — three distinct, stable, independently generated 32-byte base64url secrets. Do not rotate them casually: rotation invalidates browser sessions/cursors or makes stored feed URLs undecryptable.

The deploy script requires Cloudflare's `WORKERS_CI=1` and `WORKERS_CI_BRANCH=main` values, validates the runtime configuration and 32-byte keys, applies remote D1 migrations, passes the Worker secrets to Wrangler, then deploys. Temporary config/secret files are removed afterwards. Do not replace this with `wrangler secret put` from a developer machine: that command deploys immediately and bypasses the main-only deployment flow.

Production deployment still occurs only from `main`, after the temporary implementation branch has passed validation and been promoted through its v2.0x phase checkpoint(s) and v3.00 release PR. The deploy script applies all pending migrations for the two D1 databases before publishing. Create the `ltm-todo-sync` database and `ltm-todo-attachments` R2 bucket, and configure valid unique Cloudflare rate-limit namespace IDs in `wrangler.jsonc` before the first deployment of these bindings.

## Related commands

From `apps/web`:

- `npm run dev` — standard Next.js development
- `npm run dev:vinext` — Cloudflare/vinext development
- `npm run build` — standard Next.js production build
- `npm run build:vinext` — Cloudflare Worker production build

The Worker name is fixed by `wrangler.jsonc` as `ltm-todo-app`.

## Background push notifications

Web reminders use the same `ltm-todo-app` Worker. Before enabling them in production:

1. Create the D1 database `ltm-todo-notifications` with `npx wrangler d1 create ltm-todo-notifications`. Add its returned ID to Cloudflare Workers Builds as the secret `D1_DATABASE_ID`; do not commit the real ID.
2. Generate a dedicated, stable VAPID key pair with `node scripts/generate-vapid-keys.mjs`. Add its private value to Workers Builds as the secret `VAPID_PRIVATE_KEY`; never put it in Git and do not rotate this pair after devices subscribe.
3. Set the VAPID public key and a valid subject (prefer the public HTTPS app origin) in `wrangler.jsonc`. These are public Web Push configuration values, not credentials.
4. Deploy only from `main`. The build command applies D1 migrations before publishing the Worker; Cron Triggers are configured for once per minute.

The web app stores tasks locally. When push is enabled, it sends reminder titles and scheduled instants plus the browser push subscription to D1 so reminders can still be delivered after the site closes. Each device has a separate subscription and only syncs reminders from that device's local task data. In Settings, use **Send test notification** to verify the device push path. Delivery is minute-level and can be delayed by the browser push service. iPhone/iPad Web Push requires an installed Home Screen web app on iOS/iPadOS 16.4 or newer.


## Data boundary
The currently deployed `main` still uses the Web Push API without account task sync: task and calendar data remains in each browser's IndexedDB, while the notifications D1 stores per-install push subscription and queued reminder-delivery data (including reminder title and scheduled instant). The v3 work branch adds a separate sync D1 and R2 attachment store; those bindings are not active in production until the versioned release is promoted through `main`.
