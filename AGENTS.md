# AGENTS.md — LTM Todo App Engineering Contract

This file is authoritative for AI agents and contributors working in this repository.

## 1. Product intent
Build a polished personal productivity system delivered as a responsive web app for desktop, iPhone and iPad browsers. Users may install it to the Home Screen where supported. The app owns its task and calendar models. Do not introduce Google Calendar or another calendar service as a core dependency; interoperability may be added later only as an optional integration.

The primary home experience is a vertically scrolling chronological Dashboard. It opens at Today, scrolls forward into future dates and upward into past activity, and keeps overdue deadlines separate from everyday events. Past completed work is dimmed; users can still add a task with a past due date, which appears both in Overdue and Due on its assigned date until completed. Keep 31 calendar dates including Today (Today plus the prior 30 days); older task, completion, and scheduled-event history is automatically removed, and new due dates cannot be assigned outside that window. Due-dated completion history stays on its due/occurrence date, while undated tasks use their completion date. Each day is a section containing what is scheduled on that day and what is due on that day. Open tasks without due dates remain available in Tasks and do not appear on the Dashboard. Scheduled time and due time are separate concepts.

## 2. Git workflow
Major branches are only `main` and `vX.XX`. Version branches are permanent checkpoints and must never be deleted. Never implement, fix, refactor, clean up, audit-remediate, or maintain directly on a major branch.

Before changing code:
1. Audit repository status and requirements.
2. Identify the active version branch.
3. Update it from its intended source as appropriate.
4. Create a descriptive temporary branch from that version branch.
5. Work only on the temporary branch.

Completion flow:
`vX.XX -> temporary branch -> vX.XX -> main -> deployment/manual validation`.

Deployment/publishing is allowed only after a `vX.XX` pull request merges into `main`. Direct pushes, branch pushes, closed-but-unmerged PRs and manual dispatch must not deploy. Workflows must enforce this.

## 3. Mandatory CI loop
Repeat until clean or genuinely blocked:
**Audit -> Implement/Fix -> Validate -> Review -> Apply Changes -> Revalidate**

Audit architecture, requirements, incomplete work, regressions, security, dead code, duplication, maintainability and existing CI. Run all relevant web tests, lint, formatting, type checks, builds and security checks. Review GitHub/Codex findings and resolve actionable items. Preserve unrelated changes.

GitHub CI runs only on pushes to permanent version branches (`vX.XX`), not on `main`, pull requests, or temporary branches. Run relevant checks locally on the temporary branch before opening or merging its PR. After it merges into a version branch, wait for that branch's CI to pass before promoting the version to `main`. The `main` ruleset must require a PR and successful `web` and `docs` checks. Validate PR source/base names locally with `bash scripts/check-branch-flow.sh <base> <head>`. Cloudflare Workers Builds deploys production from `main`; disable preview builds so version and temporary branches never deploy. GitHub Actions must not deploy.

Classify audit results as:
- Completed / Passed
- Requires Manual Validation
- Incomplete / Needs Work

## 4. Architecture rules
- Domain logic must not depend on UI frameworks.
- Stable UUIDs for synchronizable entities from day one.
- Store created/updated timestamps and revision/version metadata needed for future sync.
- Support soft deletion/tombstones for syncable records.
- Automatically purge task, completion, and scheduled-event history older than the 31-calendar-day Dashboard window; legacy child task records are retained as standalone tasks.
- Model due time separately from scheduled start/end.
- Recurrence is structured data, not display text.
- Calendar events and tasks are distinct domain entities.
- Local persistence is authoritative for interactive behavior; network sync is asynchronous.
- Time-zone behavior must be explicit and tested.
- Accessibility, responsive layouts, keyboard navigation and reduced-motion behavior are product requirements.
- Never put secrets in source control.
- The supported client is the TypeScript/React web app. Do not add a native Apple application, Swift package, Xcode project, or native-app build/test workflow.

## 5. Target client
- Desktop, iPhone and iPad: responsive TypeScript/React web app, installable to the Home Screen on supported mobile browsers.
- Shared contract: versioned API/domain schemas and deterministic recurrence/date semantics.
- Backend in v3: Cloudflare Worker APIs backed by D1, per-account Durable Objects for serialized sync, and R2 for attachment bytes, as decided in ADR 0003.

## 6. Quality bar
Every phase document is an implementation contract. Do not silently omit acceptance criteria. Prefer modular, readable, testable code. Add tests with behavior. Date, recurrence, ordering, synchronization and conflict code require especially strong deterministic tests.

## 7. Definition of done
A phase is complete only when its acceptance criteria are implemented, automated validation passes, actionable review findings are resolved, documentation matches behavior, and remaining manual validation is explicitly listed. Completed temporary branches must be merged into their originating version branch; production-capable work reaches main only through the version branch.
