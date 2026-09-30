# Cloudflare Worker deployment

The web client is deployed to Cloudflare Workers as `ltm-todo-app` using Cloudflare Workers Builds.

## Production policy

Connect the GitHub repository to the existing Worker and set `main` as the production branch. Disable preview builds so pushes to version and temporary branches do not deploy. Cloudflare builds and deploys when a commit reaches `main`; GitHub Actions does not deploy. Protect `main` with a pull request requirement and require the version-branch CI checks before merging.

## Workers Builds settings

- Repository: `OrangeCheasy/LTM-Todo-App`
- Production branch: `main`
- Root directory: `apps/web`
- Build command: `npm run build:vinext`
- Deploy command: `npx wrangler deploy --config dist/server/wrangler.json`
- Preview builds: disabled

Workers Builds installs dependencies automatically. Keep any Cloudflare API token in Cloudflare's build settings; do not put it in the repository.

## Related commands

From `apps/web`:

- `npm run dev` — standard Next.js development
- `npm run dev:vinext` — Cloudflare/vinext development
- `npm run build` — standard Next.js production build
- `npm run build:vinext` — Cloudflare Worker production build

The Worker name is fixed by `wrangler.jsonc` as `ltm-todo-app`.
