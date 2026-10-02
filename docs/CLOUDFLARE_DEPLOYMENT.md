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

Add these production-only entries under **Settings → Builds → Build variables and secrets** as secrets:

- `D1_DATABASE_ID` — the UUID of the production D1 database. It is a database identifier, not an access credential, but this public repository keeps it out of Git by injecting it into temporary Wrangler config files during deployment.
- `VAPID_PRIVATE_KEY` — the private half of the dedicated Web Push VAPID key pair.

The deploy script requires Cloudflare's `WORKERS_CI=1` and `WORKERS_CI_BRANCH=main` values, applies remote D1 migrations, passes the private VAPID key to Wrangler as a runtime Worker secret, then deploys. Temporary config/secret files are removed afterwards. Do not replace this with `wrangler secret put` from a developer machine: that command deploys immediately and bypasses the main-only deployment flow.

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
The Worker also serves the Web Push API, but this is not a task-data backend. Task and calendar data remains in each browser's IndexedDB. D1 stores per-install push subscription and queued reminder-delivery data (including reminder title and scheduled instant); it does not synchronize user tasks between devices. Account-based task sync is planned for v3.