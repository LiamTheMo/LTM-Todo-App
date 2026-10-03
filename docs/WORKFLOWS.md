# Engineering Workflows

## Branches
Permanent: `main`, `vX.XX`.
Temporary examples: `feat/dashboard-stream`, `fix/recurrence-dst`, `docs/task-model`.

Never develop directly on permanent branches. Never delete permanent version branches.

## CI loop
1. Audit current state and requirements.
2. Implement the smallest coherent slice.
3. Run web formatting/lint/type/tests/build/security locally on the temporary branch.
4. Validate the intended PR base and head with `bash scripts/check-branch-flow.sh <base> <head>`.
5. Review the diff and automated review findings.
6. Apply valid findings.
7. Revalidate.
8. Repeat until clean or manually blocked.

GitHub App CI and documentation checks run only after pushes to `vX.XX` version branches; pushes to `main`, pull requests and temporary-branch pushes do not start GitHub Actions CI. After merging a temporary PR into its version branch, wait for all version-branch CI checks to finish and pass before promoting that version to `main`. Inspect the Actions logs for warnings or failures and fix actionable issues before promotion. The `main` ruleset must require a PR and successful `web` and `docs` checks. The repository contains no Swift package, native Apple app, Xcode build or native CI job. Cloudflare Workers Builds deploys from `main` only, with preview builds disabled.

The web dependency gate fails on all high/critical production findings. It also audits the full dependency tree and temporarily permits only GHSA-vfj7-8cjw-p6xm when every affected package path is confirmed `dev: true` in the lockfile. That advisory affects the `braces` build/lint toolchain and currently has no patched release. The exception is enforced and tested in `apps/web/scripts/audit-policy.mjs`; remove it when upstream publishes a fix. Any other high/critical full-tree advisory fails CI.

## Pull requests
Temporary -> originating version branch. PR body states scope, acceptance criteria, local validation, manual validation and known limitations. After merge, wait for the version-branch CI result. When a version is ready for deployed/manual testing, merge version -> main through a PR. The `main` ruleset blocks merges until required checks pass. Cloudflare Workers Builds deploys the resulting `main` commit.

## Documentation
Behavioral changes update relevant specs in the same PR. Architecture changes add/update ADRs. Phase status must not be marked complete before acceptance criteria pass.

## Commit guidance
Use focused conventional-style messages such as `feat(dashboard): add lazy day stream`, `fix(recurrence): preserve local date across DST`, `docs: define sync conflict semantics`.

## Review checklist
Correctness; edge cases; offline behavior; date/time zones; accessibility; privacy/security; migrations; tests; performance; duplication; dead code; documentation drift.
