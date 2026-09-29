# Cloudflare Worker deployment

The web client is deployed to Cloudflare Workers as `ltm-todo-app`.

## Production policy

Production deployment is triggered only when a same-repository `vX.XX` pull request is **merged into `main`**. Closing a PR without merging, pushing to `main` directly, pushing a temporary or version branch, and manual workflow dispatch do not trigger deployment.

The workflow builds the merge commit, checks that the source branch matches `vX.XX`, and checks `origin/main` immediately before deploying. If another merge has superseded it, the older run skips deployment. Every qualifying version-to-main merge runs web tests, typecheck, lint and the Cloudflare Worker build first.

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
Deployment is performed by `.github/workflows/deploy-cloudflare.yml` after the qualifying merge.

The Worker name is fixed by `wrangler.jsonc` as `ltm-todo-app`.
