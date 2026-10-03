# Phase 4 — Projects, Sections, Subtasks & Tags
**Target:** v1.00

## Objective
Scale task organization without making quick capture cumbersome.

## Scope
Unlimited projects; project archive; ordered sections; tags many-to-many; project/task reorder; move task between projects/sections; project detail; master Tasks view; batch organization primitives needed later.

## Rules
Inbox means no organized project assignment according to the chosen invariant. Tag renames preserve tag identity. Project archive hides normal active views without deleting tasks. Subtasks are not part of the current product; legacy child tasks migrate as standalone tasks. Stable sort keys prevent full-list rewrites.

## UX
Quick capture remains minimal. Organization controls live in task detail/menus. Project screens support sections and clear task counts. iPad/web use available width rather than stretching phone cards.

## Tests
Move/reorder; archive/unarchive; tag rename/delete; many-to-many tags; flat task completion; section deletion/move policy; persistence restart; sorting collisions.

## Acceptance criteria
Organization never changes task identity/history. Archived data is recoverable. Reordering is stable. Dashboard queries continue to work regardless of project organization. No artificial count limits.

## Manual validation
Drag/drop or reorder interactions, keyboard navigation, VoiceOver reorder alternatives, narrow/wide layouts.

## AI execution prompt
Implement Phase 4 after auditing prior phase invariants. Keep organization orthogonal to scheduling/deadlines. Add explicit tests for destructive project/section actions and ordering. Follow CI loop and merge the temporary branch into its originating version branch only after review.
