# Phase 1 — Engineering Foundation & Design System
**Target:** v1.00

## Objective
Create production-grade Apple/web workspace foundations without prematurely building product features. Establish module boundaries, design tokens, test infrastructure, local persistence abstraction and deterministic date/time utilities.

## Scope
- Apple workspace/app targets for iPhone/iPad using SwiftUI.
- Web workspace using TypeScript + Next.js/React.
- Domain/application modules that do not import UI frameworks.
- Shared behavioral fixtures/schema directory usable by both clients.
- Design tokens: typography roles, spacing, radii, semantic colors, elevations, icon conventions, motion durations.
- Navigation shells: iPhone tab/navigation structure; iPad sidebar/content structure; web responsive shell.
- Repository interfaces for tasks/projects/events without committing domain code to a specific database API.
- Clock, calendar and UUID dependency injection for deterministic tests.
- Logging/error conventions and environment configuration.
- Automated format/lint/type/test/build workflows appropriate to created code.

## Required engineering
Prefer feature/domain modules over giant utility folders. Define dependency direction: UI -> application -> domain; infrastructure implements interfaces inward. Add test fixtures for DST boundaries, locale-independent dates, midnight transitions and stable ordering. Establish migration numbering before real data exists.

## UX foundation
Dashboard is the default destination. Navigation reserves Inbox, Dashboard, Tasks, Projects and Settings; Calendar may remain disabled/placeholder until v2. Ensure Dynamic Type and reduced-motion choices are possible from the token/component layer.

## Tests
- Unit test injected clock/calendar behavior.
- Smoke-test app startup on supported Apple simulator targets.
- Web typecheck/build and basic navigation test.
- Verify domain package has no forbidden presentation dependencies.
- Accessibility identifiers for critical shell navigation.

## Acceptance criteria
- Clean builds and tests on CI.
- iPhone and iPad layouts do not simply scale the same narrow UI.
- Web shell responds across phone/tablet/desktop widths.
- No production feature depends on network availability.
- No secret/config credential is committed.
- Architecture docs reflect actual module layout.

## Manual validation
Launch on at least one iPhone simulator/device, one iPad simulator/device and major desktop browser. Check navigation, Dynamic Type, light/dark mode if supported, keyboard focus on iPad/web.

## AI execution prompt
Implement Phase 1 exactly from this document and repository specs. First audit the repo and active version branch, create a temporary branch, then execute the mandatory CI loop. Build foundations only; do not invent task features from later phases. Preserve domain/UI separation, add deterministic date fixtures and report acceptance criteria as Passed, Manual Validation, or Needs Work. Merge the completed temporary branch back to its originating version branch after checks/review are clean.
