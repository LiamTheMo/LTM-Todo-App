# Phase 9 — Kanban, Routines, Templates & Smart Views
**Target:** v2.00

## Objective
Add power-user planning without making the core Dashboard complex.

## Scope
Kanban views; configurable grouping; task/event templates where semantically valid; routines built from repeatable task templates; saved smart filters/views; bulk edit; planning review flow; optional custom Dashboard filters; template version/update behavior.

## Design constraints
Advanced features live behind discoverable secondary surfaces. Default task capture remains fast. Saved views store predicates/sort/group configuration rather than copied task IDs. Templates create new identity; they do not clone sync metadata.

## Tests
Kanban move semantics; saved predicate evaluation; template instantiation; routine recurrence; bulk edit atomicity/partial failure policy; migration compatibility.

## Acceptance criteria
Power features do not change basic task semantics. Saved views remain deterministic. Templates never duplicate UUIDs. Bulk operations are undoable or clearly confirmed where destructive.

## AI execution prompt
Implement Phase 9 as composable application-layer capabilities over existing domain models. Avoid adding one-off fields solely for a single view. Audit complexity and keep Dashboard defaults uncluttered.
