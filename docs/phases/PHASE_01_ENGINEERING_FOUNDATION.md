# Phase 1 — Engineering Foundation & Design System
**Target:** v1.00

## Objective
Create a production-grade responsive web workspace without prematurely building product features. Establish module boundaries, design tokens, test infrastructure, local persistence abstraction and deterministic date/time utilities.

## Scope
- Web workspace using TypeScript, React and Next.js/Vinext.
- Domain/application modules that do not import UI frameworks.
- Shared behavioral fixtures and versioned schemas.
- Design tokens: typography roles, spacing, radii, semantic colors, elevations, icon conventions and motion durations.
- Responsive web navigation shells for phone, tablet and desktop.
- Repository interfaces for tasks/projects/events without committing domain code to a specific database API.
- Clock, calendar and UUID dependency injection for deterministic tests.
- Logging/error conventions and environment configuration.
- Automated lint/type/test/build workflows appropriate to the web application.

## Required engineering
Prefer feature/domain modules over giant utility folders. Define dependency direction: UI -> application -> domain; infrastructure implements interfaces inward. Add test fixtures for DST boundaries, locale-independent dates, midnight transitions and stable ordering. Establish migration numbering before real data exists.

## UX foundation
Dashboard is the default destination. Navigation reserves Inbox, Dashboard, Tasks, Projects and Settings; Calendar may remain disabled/placeholder until v2. Ensure responsive layouts, keyboard accessibility and reduced-motion choices are possible from the token/component layer.

## Tests
- Unit test injected clock/calendar behavior.
- Web typecheck/build and basic navigation test.
- Verify domain package has no forbidden presentation dependencies.
- Accessibility coverage for critical navigation.

## Acceptance criteria
- Clean web builds and tests on CI.
- Responsive shell works across phone, tablet and desktop widths.
- No production feature depends on network availability.
- No secret/config credential is committed.
- Architecture docs reflect actual module layout.

## Manual validation
Check a major desktop browser and phone/tablet browser layouts, navigation, accessibility settings, light/dark mode if supported, and keyboard focus.

## AI execution prompt
Implement Phase 1 exactly from this document and repository specs. First audit the repo and active version branch, create a temporary branch, then execute the mandatory CI loop. Build foundations only; do not invent task features from later phases. Preserve domain/UI separation, add deterministic date fixtures and report acceptance criteria as Passed, Manual Validation, or Needs Work. Merge the completed temporary branch back to its originating version branch after checks/review are clean.
