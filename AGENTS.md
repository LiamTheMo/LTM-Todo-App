# AGENTS.md — LTM Todo App Engineering Contract

This file is authoritative for AI agents and contributors working in this repository.

## 1. Product intent
Build a polished personal productivity system for iPhone, iPad, and web. The app owns its task and calendar models. Do not introduce Google Calendar or another calendar service as a core dependency. External interoperability may be added later only as optional integration.

The primary home experience is a vertically scrolling chronological Dashboard. It opens at Today, scrolls forward into future dates and upward into past activity, and keeps overdue deadlines separate from everyday events. Past completed work is dimmed; users can still add a task with a past due date, which appears in Overdue until completed. Due-dated completion history stays on its due/occurrence date, while undated tasks use their completion date. Each day is a section containing what is scheduled on that day and what is due on that day. Scheduled time and due time are separate concepts.

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

Audit architecture, requirements, incomplete work, regressions, security, dead code, duplication, maintainability and existing CI. Run all relevant tests, lint, formatting, type checks, builds and security checks. Review GitHub/Codex findings and resolve actionable items. Preserve unrelated changes.

GitHub CI runs only on pushes to permanent major branches (`main` and `vX.XX`), not on temporary branches or pull requests. Run the relevant checks locally on the temporary branch before opening or merging its PR. After it merges into a version branch, wait for that branch's CI to pass before promoting the version to `main`. Validate PR source/base names locally with `bash scripts/check-branch-flow.sh <base> <head>`. The production deployment remains a separate workflow that runs only for a merged same-repository `vX.XX -> main` PR.

Classify audit results as:
- Completed / Passed
- Requires Manual Validation
- Incomplete / Needs Work

## 4. Architecture rules
- Domain logic must not depend on UI frameworks.
- Stable UUIDs for synchronizable entities from day one.
- Store created/updated timestamps and revision/version metadata needed for future sync.
- Support soft deletion/tombstones for syncable records.
- Model due time separately from scheduled start/end.
- Recurrence is structured data, not display text.
- Calendar events and tasks are distinct domain entities.
- Local persistence is authoritative for interactive client behavior; network sync is asynchronous.
- Time-zone behavior must be explicit and tested.
- Accessibility, Dynamic Type, keyboard navigation and reduced-motion behavior are product requirements.
- Never put secrets in source control.

## 5. Target clients
- iPhone/iPad: Swift + SwiftUI, native notifications/widgets/Shortcuts capabilities when their phase is reached.
- Web: TypeScript + React/Next.js.
- Shared contract: versioned API/domain schemas and deterministic recurrence/date semantics.
- Backend in v3: API/sync service backed by PostgreSQL unless an ADR deliberately changes this.

Do not force UI code sharing between SwiftUI and React. Share behavior through specifications, schemas, fixtures and conformance tests.

## 6. Quality bar
Every phase document is an implementation contract. Do not silently omit acceptance criteria. Prefer modular, readable, testable code. Add tests with behavior. Date, recurrence, ordering, synchronization and conflict code require especially strong deterministic tests.

## 7. Definition of done
A phase is complete only when its acceptance criteria are implemented, automated validation passes, actionable review findings are resolved, documentation matches behavior, and remaining manual validation is explicitly listed. Completed temporary branches must be merged into their originating version branch; production-capable work reaches main only through the version branch.
