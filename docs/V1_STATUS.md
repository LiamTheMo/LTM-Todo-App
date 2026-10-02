# v1.00 Tasks & Dashboard — Release Record

## Scope and client status

v1.00 covers Phases 1–6. The supported iPhone/iPad/desktop experience is the responsive web app. Browser task data is stored locally in IndexedDB. `apps/apple` remains experimental source; current GitHub Actions does not build, sign, or distribute it.

## Completed release record

- The permanent `v1.00` checkpoint was created from validated v1 work on 2026-10-01.
- The user's prior manual validations covered the supported phone/tablet workflow, including Web Push setup/delivery and accessibility/input checks.
- The main ruleset requires `swift-core`, `apple`, `web`, and `docs`. The `apple` job now confirms native builds are intentionally disabled; it is not evidence of a native app build.
- The v1 scope is local-first. Each browser has its own task data. Web Push stores per-install subscription/queue information in Cloudflare D1 and does not synchronize task data.

## Scope boundaries

- First-party calendar and planning work belongs to v2 and is recorded in [V2_STATUS.md](V2_STATUS.md).
- Accounts and cross-device task synchronization belong to v3. The deployed v1/v2 app has no account or task-sync backend.
- V1 status records the release checkpoint; current behavior and limitations are in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
