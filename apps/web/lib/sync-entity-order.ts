/** Parents precede dependants in both upload batches and paged snapshots. */
export const SYNC_ENTITY_ORDER = [
  "preferences", "calendars", "projects", "tags", "sections", "tasks", "taskTemplates", "eventTemplates",
  "calendarEvents", "blocks", "reminders", "routines", "completions", "savedViews"
] as const;

export const syncEntityPriority: Readonly<Record<string, number>> = Object.fromEntries(
  SYNC_ENTITY_ORDER.map((type, index) => [type, index])
);

// Only compile-time entity names enter this expression; account IDs and cursors remain bound parameters.
export const syncEntityOrderSql = `CASE entity_type ${SYNC_ENTITY_ORDER.map((type, index) =>
  `WHEN '${type}' THEN ${index}`).join(" ")} ELSE ${SYNC_ENTITY_ORDER.length} END`;
