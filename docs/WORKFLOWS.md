# Engineering Workflows

## Branches
Permanent: `main`, `vX.XX`.
Temporary examples: `feat/dashboard-stream`, `fix/recurrence-dst`, `docs/task-model`.

Never develop directly on permanent branches. Never delete permanent version branches.

## CI loop
1. Audit current state and requirements.
2. Implement smallest coherent slice.
3. Validate formatting/lint/type/tests/build/security.
4. Review diff, GitHub checks and automated review findings.
5. Apply valid findings.
6. Revalidate.
7. Repeat until clean or manually blocked.

## Pull requests
Temporary -> originating version branch. PR body states scope, acceptance criteria, automated validation, manual validation and known limitations. After merge, validate version branch. When a version is ready for deployed/manual testing, merge version -> main through a PR. The production workflow responds only to a merged `vX.XX -> main` PR and verifies the merge commit is still current on `main` before deploying.

## Documentation
Behavioral changes update relevant specs in the same PR. Architecture changes add/update ADRs. Phase status must not be marked complete before acceptance criteria pass.

## Commit guidance
Use focused conventional-style messages such as `feat(dashboard): add lazy day stream`, `fix(recurrence): preserve local date across DST`, `docs: define sync conflict semantics`.

## Review checklist
Correctness; edge cases; offline behavior; date/time zones; accessibility; privacy/security; migrations; tests; performance; duplication; dead code; documentation drift.
