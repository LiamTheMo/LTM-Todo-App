# Cloudflare Worker deployment

The web client is deployed to Cloudflare Workers as `ltm-todo-app` using Cloudflare Workers Builds.

## Production policy

Connect the GitHub repository to the existing Worker and set `main` as the production branch. Disable preview builds so pushes to version and temporary branches do not deploy. Cloudflare builds and deploys when a commit reaches `main`; GitHub Actions does not deploy. Protect `main` with a pull request requirement and require the version-branch CI checks before merging.

## Workers Builds settings

- Repository: `OrangeCheasy/LTM-Todo-App`
- Production branch: `main`
- Root directory: `apps/web`
- Build command: `npm run build:vinext`
- Deploy command: `npx wrangler d1 migrations apply ltm-todo-notifications --remote --config wrangler.jsonc && npx wrangler deploy --config dist/server/wrangler.json`
- Preview builds: disabled

Workers Builds installs dependencies automatically. Keep any Cloudflare API token in Cloudflare's build settings; do not put it in the repository.

## Related commands

From `apps/web`:

- `npm run dev` — standard Next.js development
- `npm run dev:vinext` — Cloudflare/vinext development
- `npm run build` — standard Next.js production build
- `npm run build:vinext` — Cloudflare Worker production build

The Worker name is fixed by `wrangler.jsonc` as `ltm-todo-app`.

## Background push notifications

Web reminders use the same `ltm-todo-app` Worker. Before enabling them in production:

1. Create the D1 database `ltm-todo-notifications` with `npx wrangler d1 create ltm-todo-notifications` and replace the placeholder `database_id` in `wrangler.jsonc` with the returned ID.
2. Generate a dedicated, stable VAPID key pair with `node scripts/generate-vapid-keys.mjs`. Keep the private value out of Git and do not rotate this pair after devices subscribe.
3. Set `VAPID_PUBLIC_KEY` and a valid `VAPID_SUBJECT` (`mailto:` contact or HTTPS app origin) in `wrangler.jsonc`. Set `VAPID_PRIVATE_KEY` as a Worker secret with `npx wrangler secret put VAPID_PRIVATE_KEY --config wrangler.jsonc`.
4. Deploy from `main`. The deploy command applies D1 migrations before publishing the Worker; Cron Triggers are configured for once per minute.

The web app stores tasks locally. When push is enabled, it sends reminder titles and scheduled instants plus the browser push subscription to D1 so reminders can still be delivered after the site closes. Each device has a separate subscription and only syncs reminders from that device's local task data. In Settings, use **Send test notification** to verify the device push path. Delivery is minute-level and can be delayed by the browser push service. iPhone/iPad Web Push requires an installed Home Screen web app on iOS/iPadOS 16.4 or newer.
