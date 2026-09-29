# Cloudflare Worker deployment

The web client is deployed to Cloudflare Workers as `ltm-todo-app`.

## Production policy

Production deployment is triggered only from `main` when `apps/web/**` or the deployment workflow changes. Development and permanent version branches do not deploy.

Required GitHub Actions repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The token must never be committed to the repository.

## Commands

From `apps/web`:

- `npm run dev` — standard Next.js development
- `npm run dev:vinext` — Cloudflare/vinext development
- `npm run build` — standard Next.js production build
- `npm run build:vinext` — Cloudflare Worker production build
- `npm run deploy` — build and deploy with Wrangler (requires Cloudflare credentials)

The Worker name is fixed by `wrangler.jsonc` as `ltm-todo-app`.
