# Cloudflare Worker deployment

The web client is deployed to Cloudflare Workers as `ltm-todo-app` by the GitHub Actions workflow `.github/workflows/deploy-production.yml` (**Production Deploy**).

## Production policy

The workflow runs only when a pull request from a permanent version branch (`vX.XX`) in this repository is **merged** into `main`. Direct pushes, other branches, unmerged or forked pull requests and manual dispatch never deploy; `apps/web/scripts/deploy-worker.mjs` re-checks the event and the checked-out merge commit before touching Cloudflare. If `main` has already moved past a merge, that run skips and the newer merge's run deploys. Runs are serialized. Protect `main` with a pull request requirement and require the version-branch CI checks before merging.

Each run installs dependencies, runs the dependency audit and tests, builds with `npm run build:vinext`, applies remote D1 migrations and deploys with Wrangler.

## One-time setup

1. **Disconnect Cloudflare Workers Builds.** In the Cloudflare dashboard open **Workers & Pages → `ltm-todo-app` → Settings → Build** and disconnect the Git repository so Cloudflare no longer builds on push. (If it stays connected its deploy step fails, because the deploy script only runs inside the GitHub workflow.)
2. **Create a Cloudflare API token.** **Manage Account → Account API Tokens → Create Token → Custom token** with **Account → Workers Scripts → Edit** and **Account → D1 → Edit**, limited to your account. Note your **Account ID** from the Workers & Pages overview. If a deploy fails with a permission error, add **Account → Account Settings → Read**.
3. **Create the GitHub environment.** In GitHub open **Settings → Environments → New environment** named `production`. Leave **Deployment branches and tags** at **No restriction**: the workflow runs on the pull-request event (ref `refs/pull/N/merge`), so a `main`-only rule would block it, and the workflow already enforces the branch policy. Optionally add yourself as a required reviewer to approve each deploy.
4. **Add the secrets** listed below (repository secrets or `production` environment secrets both work; environment secrets are readable only by the deploy job). Only the Cloudflare token and account ID are required: the deploy looks up the D1 databases by name, and the Worker keeps runtime secrets from earlier deploys.

## Secrets

Required:

- `CLOUDFLARE_API_TOKEN` — an account-owned API token with **Account → Workers Scripts → Edit** and **Account → D1 → Edit**, limited to your account. Use a token dedicated to this project, never a full-access token or the Global API Key.
- `CLOUDFLARE_ACCOUNT_ID` — the 32-character account ID from the Workers & Pages overview.

Optional D1 overrides. When unset, the deploy runs `wrangler d1 list` with the token and uses the databases named in `wrangler.jsonc` (`ltm-todo-notifications`, `ltm-todo-sync`); exactly one database must have each name:

- `D1_DATABASE_ID` — the 36-character UUID (**Database ID**, not the name) of `ltm-todo-notifications`. Database IDs are identifiers, not credentials; this public repository keeps them out of Git by injecting them into temporary Wrangler config files during deployment.
- `SYNC_D1_DATABASE_ID` — the UUID of the separate `ltm-todo-sync` account-sync database.

Optional runtime secrets. Set one only to create or change that Worker secret; an unset or empty value keeps the Worker's current value. Supplied values are validated before deploying:

- `VAPID_PRIVATE_KEY` — the private half of the dedicated Web Push VAPID key pair.
- `OIDC_ISSUER` and `OIDC_JWKS_URI` — copy the exact `issuer` and `jwks_uri` values from the provider's `/.well-known/openid-configuration` document. `OIDC_AUDIENCE` — the API/resource identifier expected in access-token `aud`; the app sends it as the authorization `audience` parameter for providers that support that convention, including Auth0. `OIDC_CLIENT_ID` — the registered app's client ID. `OIDC_REDIRECT_URI` — the exact callback `<app-origin>/api/v1/auth/callback` registered with the provider.
- `OIDC_CLIENT_SECRET` — optional; only needed for a confidential OIDC client.
- `AUTH_SESSION_SECRET`, `SYNC_CURSOR_SECRET`, and `ICS_FEED_ENCRYPTION_KEY` — three distinct, stable, independently generated 32-byte base64url secrets. Do not rotate them casually: rotation invalidates browser sessions/cursors or makes stored feed URLs undecryptable.

The deploy script requires the merged `vX.XX -> main` pull-request event and its checked-out merge commit, validates the runtime configuration and 32-byte keys, applies remote D1 migrations, passes the Worker secrets to Wrangler, then deploys. Temporary config/secret files are removed afterwards. Do not replace this with `wrangler secret put` from a developer machine: that command deploys immediately and bypasses the version-branch-to-main deployment flow.

Production deployment still occurs only through the GitHub workflow, after a temporary implementation branch passes validation, merges into its originating `vX.XX` checkpoint, and that version branch is promoted through a pull request. The deploy script applies all pending migrations for the two D1 databases before publishing. Create the `ltm-todo-sync` database and `ltm-todo-attachments` R2 bucket, and configure valid unique Cloudflare rate-limit namespace IDs in `wrangler.jsonc` before the first deployment of these bindings.

## Related commands

From `apps/web`:

- `npm run dev` — standard Next.js development
- `npm run dev:vinext` — Cloudflare/vinext development
- `npm run build` — standard Next.js production build
- `npm run build:vinext` — Cloudflare Worker production build

The Worker name is fixed by `wrangler.jsonc` as `ltm-todo-app`.

## Staying signed in (refresh tokens)

Sign-in requests the `openid offline_access` scopes. When the provider returns a refresh token, the Worker keeps it only inside the encrypted, `HttpOnly` session cookie (never in D1, logs, or browser JavaScript) and the browser session becomes refreshable:

- The session cookie and its server-session registry entry last 30 days and roll forward on every successful refresh, so a device in regular use stays signed in.
- `GET /api/v1/auth/session` redeems the refresh token when the access token has expired or expires within 5 minutes, then returns the replacement cookie. The web client checks the session before every sync (at least once a minute while open and whenever the app becomes visible), so access tokens are renewed before API calls need them. Other API routes still require an unexpired access token and never refresh.
- Session checks are serialized across tabs with the Web Locks API, so a rotating refresh token is redeemed once per browser.
- A definitive provider rejection (for example `invalid_grant` after the refresh token expires or is revoked), a revoked app session, or an identity mismatch signs the browser out. Provider outages, rate limits, and network failures keep the cookie; the session endpoint returns `503 authentication_unavailable` only if the access token has already expired, and the next check retries.
- Signing out revokes the app session and, when discovery advertises a `revocation_endpoint`, makes a best-effort revocation of the refresh token at the provider. Revoking a session in Settings blocks its next refresh.

Auth0 configuration required for this (the app keeps working with the old access-token-lifetime sessions until it is done):

1. **Applications → APIs →** the API whose identifier is `OIDC_AUDIENCE` **→ Settings:** enable **Allow Offline Access**.
2. **Applications →** the LTM Todo application **→ Settings → Advanced Settings → Grant Types:** enable **Refresh Token**.
3. **Refresh Token Expiration** (same application): set an **Absolute Lifetime** and **Inactivity Lifetime** that match how long a device should stay signed in without a fresh login (for example 90 days absolute, 30 days inactivity). The app session cannot outlive the refresh token.
4. **Refresh Token Rotation** is optional. If enabled, set a **Reuse Interval** of at least 30 seconds so that a refresh whose response is lost in transit (for example, a timed-out mobile request) does not trigger reuse detection and revoke the device's session.

Browser sessions created before this change carry no refresh token; they end at the original access-token expiry, and the next sign-in creates a refreshable session.

## Authentication failure logs

The auth API keeps provider failures generic for browsers and emits a redacted Worker log event named `oidc_authentication_failure`. It contains a fixed route label and diagnostic code. Rejected token exchanges also include only a numeric `providerStatus` and an allowlisted `providerError` value (standard OAuth errors, `other`, or `unknown`). It never logs the exception text, provider error description, query string, cookies, tokens, or configured secret values. Review the `ltm-todo-app` Worker logs in Cloudflare after reproducing a sign-in failure.

`apps/web/wrangler.jsonc` enables Workers Logs with full sampling and disables invocation logs so raw request URLs do not capture Auth0 callback `code` and `state` query values. The redacted `oidc_authentication_failure` custom event remains available after the `main` deployment. Keep invocation logs disabled while diagnosing sign-in.

Diagnostic codes:

- `provider_discovery_fetch_failed`, `provider_discovery_http_error`, `provider_discovery_invalid_document`, `provider_issuer_mismatch`, `provider_jwks_uri_mismatch`, and `provider_endpoint_invalid` identify discovery fetch, HTTP, document, or configuration failures.
- `callback_provider_error`, `callback_flow_invalid`, `callback_code_invalid`, and `callback_request_invalid` identify an Auth0 callback error or invalid/missing login-flow state.
- `callback_token_exchange_failed` and `callback_token_exchange_rejected` distinguish a failed token request from a non-success Auth0 response. A rejection also records its HTTP status and a fixed OAuth error category; the provider's error description is omitted.
- `callback_token_response_invalid`, `callback_id_token_invalid`, and `callback_access_token_invalid` identify malformed token data or a token that failed verification. Access-token checks include issuer, API audience, authorized-party (`azp`/client ID), signature, and time claims; ID-token checks also include the client ID audience and nonce.
- `callback_token_verification_failed` means the Worker could not complete signing-key verification; `callback_identity_mismatch` means the verified tokens identify different subjects or issuers.
- `callback_session_cookie_too_large` means the encrypted session exceeded the safe cookie-size limit. A refresh token that would not fit is dropped and the session lasts only for the access-token lifetime.
- `session_refresh_failed` (network or verification failure) and `session_refresh_response_invalid` (malformed token response) keep the browser session for a later retry. `session_refresh_rejected` records the numeric `providerStatus` and allowlisted `providerError`; a 4xx response other than 408/429 signs the browser out, while 408, 429, and 5xx responses are retried. `session_refresh_token_invalid` means the refreshed access token failed verification or identified a different subject, and signs the browser out.
- `unexpected_error` identifies an otherwise unclassified failure; no exception details are written.

Discovery and unexpected runtime failures return `503 authentication_unavailable`; rejected callback/token conditions return a generic `401` message. The exact diagnostic code is available only in Worker logs.

## Background push notifications

Web reminders use the same `ltm-todo-app` Worker. Before enabling them in production:

1. Create the D1 database `ltm-todo-notifications` with `npx wrangler d1 create ltm-todo-notifications`. Add its returned ID to the GitHub `production` environment as the secret `D1_DATABASE_ID`; do not commit the real ID.
2. Generate a dedicated, stable VAPID key pair with `node scripts/generate-vapid-keys.mjs`. Add its private value to the GitHub `production` environment as the secret `VAPID_PRIVATE_KEY`; never put it in Git and do not rotate this pair after devices subscribe.
3. Set the VAPID public key and a valid subject (prefer the public HTTPS app origin) in `wrangler.jsonc`. These are public Web Push configuration values, not credentials.
4. Deploy only from `main`. The build command applies D1 migrations before publishing the Worker; Cron Triggers are configured for once per minute.

The web app stores tasks locally. When push is enabled, it sends reminder titles and scheduled instants plus the browser push subscription to D1 so reminders can still be delivered after the site closes. Each device has a separate subscription and only syncs reminders from that device's local task data. In Settings, use **Send test notification** to verify the device push path. Delivery is minute-level and can be delayed by the browser push service. iPhone/iPad Web Push requires an installed Home Screen web app on iOS/iPadOS 16.4 or newer.


## Data boundary
The deployed v3 release keeps IndexedDB authoritative for local task/calendar interaction and asynchronously synchronizes signed-in account records through the separate sync D1 database and per-account Durable Object. Normal production sign-in and cross-device sync were confirmed working on 2026-10-05. Notifications D1 still stores per-install push subscriptions and queued reminder-delivery data, including reminder titles and scheduled instants; Web Push is separate from account sync. Account-protected attachments use R2 with metadata in sync D1. See `V3_STATUS.md` for the remaining live attachment, ICS, lifecycle, and recovery validation.
