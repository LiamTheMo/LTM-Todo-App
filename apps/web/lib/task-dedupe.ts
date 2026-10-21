import type { Completion, Data, Priority, Task } from "./domain.ts";

const priorityRank: Record<Priority, number> = { low: 0, medium: 1, high: 2 };

/** Fields that make two tasks the same piece of work. Tags, priority and completion state may differ and are merged. */
function duplicateKey(task: Task): string {
  const recurrence = task.recurrence ? { ...task.recurrence, occurrences: undefined } : undefined;
  return JSON.stringify([
    task.title.trim().replace(/\s+/g, " ").toLocaleLowerCase(), task.dueDate ?? "", task.dueTime ?? "",
    task.dueTime ? task.dueTimeZone ?? "" : "", task.projectId ?? "", task.sectionId ?? "", task.notes.trim(),
    recurrence ? JSON.stringify(recurrence, Object.keys(recurrence).sort()) : ""
  ]);
}

/**
 * Merges tasks that are exact duplicates, typically the same task typed on two devices before they synced. Every
 * device picks the same survivor (the smallest ID), so they converge on one task. The survivor is completed if any copy
 * was, gains the copies' tags and highest priority, and inherits their sessions, events, reminders, routines and
 * completion history; the other copies are soft-deleted. Returns `data` unchanged when there is nothing to merge.
 */
export function mergeDuplicateTasks(data: Data, now = new Date()): Data {
  const groups = new Map<string, Task[]>();
  for (const task of data.tasks) {
    if (task.deletedAt) continue;
    const key = duplicateKey(task);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  const survivorOf = new Map<string, string>();
  const merged = new Map<string, Task>();
  const stamp = now.toISOString();
  for (const copies of groups.values()) {
    if (copies.length < 2) continue;
    const [survivor, ...others] = [...copies].sort((left, right) => left.id.localeCompare(right.id));
    for (const other of others) survivorOf.set(other.id, survivor.id);
    const completedAt = survivor.completedAt ?? others.map(task => task.completedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
    const priority = copies.map(task => task.priority).reduce((best, value) => priorityRank[value] > priorityRank[best] ? value : best, survivor.priority);
    const tagIds = [...new Set(copies.flatMap(task => task.tagIds))];
    const changed = completedAt !== survivor.completedAt || priority !== survivor.priority || tagIds.length !== survivor.tagIds.length;
    merged.set(survivor.id, changed ? { ...survivor, completedAt, priority, tagIds, updatedAt: stamp, revision: survivor.revision + 1 } : survivor);
    for (const other of others) merged.set(other.id, { ...other, deletedAt: stamp, updatedAt: stamp, revision: other.revision + 1 });
  }
  if (!survivorOf.size) return data;

  const repoint = <T extends { taskId?: string; updatedAt?: string; revision?: number }>(item: T): T => {
    const target = item.taskId && survivorOf.get(item.taskId);
    return target ? { ...item, taskId: target, updatedAt: stamp, revision: (item.revision ?? 0) + 1 } : item;
  };
  // Completion payloads have a fixed sync schema, so a moved completion keeps only those fields.
  const repointCompletion = (item: Completion): Completion => {
    const target = survivorOf.get(item.taskId);
    if (!target) return item;
    const { id, occurrenceDate, completedAt, clearedBlockIds } = item;
    return { id, taskId: target, completedAt, ...(occurrenceDate ? { occurrenceDate } : {}), ...(clearedBlockIds ? { clearedBlockIds } : {}) };
  };
  // One completion per task occurrence; copies completed on both devices keep the earliest record.
  const completions = data.completions.map(repointCompletion);
  const occurrence = (completion: Completion) => `${completion.taskId}|${completion.occurrenceDate ?? ""}`;
  const keptCompletions = new Map<string, Completion>();
  for (const completion of completions) {
    const kept = keptCompletions.get(occurrence(completion));
    if (!kept || completion.completedAt < kept.completedAt) keptCompletions.set(occurrence(completion), completion);
  }
  // One active reminder per task: the survivor's own, else the first inherited one.
  const inherited = new Set(data.reminders.filter(reminder => survivorOf.has(reminder.taskId)).map(reminder => reminder.id));
  const reminders = data.reminders.map(repoint);
  const activeReminder = new Map<string, string>();
  for (const reminder of [...reminders].sort((left, right) => Number(inherited.has(left.id)) - Number(inherited.has(right.id)) || left.id.localeCompare(right.id))) {
    if (!reminder.deletedAt && !activeReminder.has(reminder.taskId)) activeReminder.set(reminder.taskId, reminder.id);
  }
  return {
    ...data,
    tasks: data.tasks.map(task => merged.get(task.id) ?? task),
    completions: completions.filter(completion => keptCompletions.get(occurrence(completion)) === completion),
    blocks: data.blocks.map(repoint),
    calendarEvents: data.calendarEvents.map(repoint),
    routines: data.routines.map(repoint),
    reminders: reminders.map(reminder => reminder.deletedAt || activeReminder.get(reminder.taskId) === reminder.id ? reminder
      : { ...reminder, deletedAt: stamp, updatedAt: stamp, revision: reminder.revision + 1 })
  };
}
