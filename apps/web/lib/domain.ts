export type Priority = "none" | "low" | "medium" | "high";
export type Frequency = "daily" | "weekly" | "monthly" | "yearly";
export type Recurrence = {
  frequency: Frequency;
  interval: number;
  weekdays?: number[];
  until?: string;
  count?: number;
  anchorDate: string;
  occurrences: number;
};
export type Entity = {
  id: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  deletedAt?: string;
};
export type Task = Entity & {
  title: string;
  notes: string;
  priority: Priority;
  projectId?: string;
  sectionId?: string;
  parentTaskId?: string;
  tagIds: string[];
  sortKey: number;
  dueDate?: string; // YYYY-MM-DD: never convert a date-only deadline to UTC midnight.
  dueTime?: string; // HH:mm in dueTimeZone.
  dueTimeZone?: string;
  completedAt?: string;
  recurrence?: Recurrence;
};
export type Project = Entity & { name: string; color: string; sortKey: number; archivedAt?: string };
export type ProjectSection = Entity & { projectId: string; name: string; sortKey: number };
export type Tag = Entity & { name: string; color: string };
export type ScheduledBlock = Entity & { taskId: string; startInstant: string; endInstant: string; timeZone: string };
export type Reminder = Entity & { taskId: string; minutesBefore: number; enabled: boolean };
export type Completion = { id: string; taskId: string; occurrenceDate?: string; completedAt: string; clearedBlockIds?: string[] };
export type Data = {
  schemaVersion: 1;
  generation: number; // Monotonic document revision for cross-tab write detection.
  tasks: Task[];
  projects: Project[];
  sections: ProjectSection[];
  tags: Tag[];
  blocks: ScheduledBlock[];
  reminders: Reminder[];
  completions: Completion[];
};
export const emptyData = (): Data => ({
  schemaVersion: 1, generation: 0, tasks: [], projects: [], sections: [], tags: [], blocks: [], reminders: [], completions: []
});
export const newEntity = (now = new Date()): Entity => ({
  id: crypto.randomUUID(), createdAt: now.toISOString(), updatedAt: now.toISOString(), revision: 1
});
export const localDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const parseLocalDate = (value: string): Date => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
};
export const addDays = (value: string, days: number): string => {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return localDate(date);
};
export const historyDays = 7;
export const historyStart = (today = localDate(new Date())) => addDays(today, 1 - historyDays);
const isInRetainedHistory = (day: string, today: string) => day >= historyStart(today);
export const instantDay = (instant: string, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(instant));
  const field = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${field("year")}-${field("month")}-${field("day")}`;
};
const anchoredMonth = (anchor: string, months: number): string => {
  const [year, month, day] = anchor.split("-").map(Number);
  const first = new Date(year, month - 1 + months, 1, 12);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12).getDate();
  first.setDate(Math.min(day, lastDay));
  return localDate(first);
};
export function nextOccurrence(rule: Recurrence, after: string): string | undefined {
  if (rule.count !== undefined && rule.occurrences >= rule.count) return;
  const interval = Math.max(1, Math.floor(rule.interval));
  const ordinal = (day: string) => {
    const [year, month, date] = day.split("-").map(Number);
    return Math.floor(Date.UTC(year, month - 1, date) / 86400000);
  };
  let candidate: string;
  if (rule.frequency === "daily") {
    const index = Math.max(1, Math.floor((ordinal(after) - ordinal(rule.anchorDate)) / interval) + 1);
    candidate = addDays(rule.anchorDate, index * interval);
  } else if (rule.frequency === "weekly") {
    const anchorWeekday = parseLocalDate(rule.anchorDate).getDay();
    const weekdays = rule.weekdays?.length ? rule.weekdays : [anchorWeekday];
    const start = after > rule.anchorDate ? addDays(after, 1) : addDays(rule.anchorDate, 1);
    for (let offset = 0; offset <= interval * 7 + 7; offset++) {
      const day = addDays(start, offset);
      const weekIndex = Math.floor((ordinal(day) - ordinal(rule.anchorDate) + anchorWeekday) / 7);
      if (weekIndex % interval === 0 && weekdays.includes(parseLocalDate(day).getDay())) {
        return rule.until && day > rule.until ? undefined : day;
      }
    }
    return;
  } else {
    const [anchorYear, anchorMonth] = rule.anchorDate.split("-").map(Number);
    const [afterYear, afterMonth] = after.split("-").map(Number);
    const monthsPerStep = rule.frequency === "monthly" ? interval : interval * 12;
    let index = Math.max(1, Math.floor(((afterYear - anchorYear) * 12 + afterMonth - anchorMonth) / monthsPerStep));
    candidate = anchoredMonth(rule.anchorDate, index * monthsPerStep);
    if (candidate <= after) candidate = anchoredMonth(rule.anchorDate, ++index * monthsPerStep);
  }
  return rule.until && candidate > rule.until ? undefined : candidate;
}
export function completeTask(data: Data, id: string, now = new Date()): Data {
  const task = data.tasks.find(item => item.id === id && !item.deletedAt);
  if (!task || task.completedAt) return data;
  // A parent remains open while any direct child is unfinished.
  if (data.tasks.some(item => item.parentTaskId === id && !item.completedAt && !item.deletedAt)) return data;
  const completedAt = now.toISOString();
  const occurrenceDate = task.dueDate;
  const recurrence = task.recurrence && { ...task.recurrence, occurrences: task.recurrence.occurrences + 1 };
  const next = recurrence && nextOccurrence(recurrence, occurrenceDate ?? localDate(now));
  const clearedBlockIds = next ? data.blocks.filter(block => block.taskId === id && !block.deletedAt).map(block => block.id) : [];
  const completions = [...data.completions, { id: crypto.randomUUID(), taskId: id, occurrenceDate, completedAt, clearedBlockIds }];
  return {
    ...data, completions,
    blocks: data.blocks.map(block => clearedBlockIds.includes(block.id) ? { ...block, deletedAt: completedAt, revision: block.revision + 1 } : block),
    tasks: data.tasks.map(item => item.id === id ? {
      ...item, recurrence, dueDate: next ?? item.dueDate,
      completedAt: next ? undefined : completedAt, updatedAt: completedAt, revision: item.revision + 1
    } : item)
  };
}
export function undoCompletion(data: Data, completionId: string): Data {
  const completion = data.completions.find(item => item.id === completionId);
  if (!completion || data.completions.filter(item => item.taskId === completion.taskId).at(-1)?.id !== completionId) return data;
  return {
    ...data,
    completions: data.completions.filter(item => item.id !== completionId),
    blocks: data.blocks.map(block => completion.clearedBlockIds?.includes(block.id) ? {
      ...block, deletedAt: undefined, updatedAt: new Date().toISOString(), revision: block.revision + 1
    } : block),
    tasks: data.tasks.map(task => task.id === completion.taskId ? {
      ...task, dueDate: completion.occurrenceDate ?? task.dueDate, completedAt: undefined,
      recurrence: task.recurrence ? { ...task.recurrence, occurrences: Math.max(0, task.recurrence.occurrences - 1) } : undefined,
      updatedAt: new Date().toISOString(), revision: task.revision + 1
    } : task)
  };
}
export function saveTask(data: Data, task: Task, reminderMinutes = "", today = localDate(new Date())): Data {
  if (task.dueDate && !isInRetainedHistory(task.dueDate, today)) return data;
  const stamp = new Date().toISOString();
  const oldTask = data.tasks.find(item => item.id === task.id);
  const currentReminder = data.reminders.find(reminder => reminder.taskId === task.id && !reminder.deletedAt);
  const hasReminder = reminderMinutes !== "" && Boolean(task.dueDate && task.dueTime);
  const nextReminder: Reminder | undefined = hasReminder ? {
    ...(currentReminder ?? newEntity()), taskId: task.id, minutesBefore: Number(reminderMinutes),
    enabled: true, updatedAt: stamp, revision: currentReminder ? currentReminder.revision + 1 : 1
  } : undefined;
  return {
    ...data,
    tasks: oldTask ? data.tasks.map(item => item.id === task.id ? task :
      item.parentTaskId === task.id && (oldTask.projectId !== task.projectId || oldTask.sectionId !== task.sectionId) ? {
        ...item, projectId: task.projectId, sectionId: task.sectionId, updatedAt: stamp, revision: item.revision + 1
      } : item) : [...data.tasks, task],
    blocks: data.blocks,
    reminders: [
      ...data.reminders.map(reminder => reminder.id === currentReminder?.id ? nextReminder ?? { ...reminder, deletedAt: stamp, updatedAt: stamp, revision: reminder.revision + 1 } : reminder),
      ...(nextReminder && !currentReminder ? [nextReminder] : [])
    ]
  };
}
export type DashboardCompletion = { task: Task; completionId: string; completedAt: string };
export function dashboardDays(data: Data, start: string, length: number, today = localDate(new Date())) {
  const visible = filterTasks(data, {});
  const visibleById = new Map(visible.map(task => [task.id, task]));
  const active = visible.filter(task => !task.completedAt);
  const byId = new Map(active.map(task => [task.id, task]));
  const due = new Map<string, Task[]>();
  for (const task of active) {
    if (!task.dueDate || !isInRetainedHistory(task.dueDate, today)) continue;
    const group = due.get(task.dueDate) ?? [];
    group.push(task);
    due.set(task.dueDate, group);
  }
  const scheduled = new Map<string, { block: ScheduledBlock; task: Task; completed: boolean; completionId?: string }[]>();
  const completionByBlockId = new Map<string, string>();
  const completionByTaskId = new Map<string, string>();
  for (const completion of data.completions) {
    completionByTaskId.set(completion.taskId, completion.id);
    for (const blockId of completion.clearedBlockIds ?? []) completionByBlockId.set(blockId, completion.id);
  }
  const clearedBlockIds = new Set(completionByBlockId.keys());
  for (const block of data.blocks) {
    const task = visibleById.get(block.taskId);
    if (!task) continue;
    let date: string;
    try { date = instantDay(block.startInstant, block.timeZone); }
    catch { continue; }
    if (!isInRetainedHistory(date, today)) continue;
    const completionId = completionByBlockId.get(block.id) ?? (task.completedAt ? completionByTaskId.get(task.id) : undefined);
    const completed = Boolean(task.completedAt || completionId);
    if (completed && date > today) continue;
    if (date < today && !completed) continue;
    if (block.deletedAt && !clearedBlockIds.has(block.id)) continue;
    if (!completed && !byId.has(task.id)) continue;
    const group = scheduled.get(date) ?? [];
    group.push({ block, task, completed, completionId });
    scheduled.set(date, group);
  }

  const completed = new Map<string, DashboardCompletion[]>();
  const completionTaskIds = new Set<string>();
  for (const completion of data.completions) {
    const task = visibleById.get(completion.taskId);
    const timestamp = new Date(completion.completedAt);
    if (!task || !Number.isFinite(timestamp.getTime())) continue;
    completionTaskIds.add(task.id);
    const date = completion.occurrenceDate ?? localDate(timestamp);
    if (!isInRetainedHistory(date, today)) continue;
    const group = completed.get(date) ?? [];
    group.push({ task, completionId: completion.id, completedAt: completion.completedAt });
    completed.set(date, group);
  }
  for (const task of visible) {
    if (!task.completedAt || completionTaskIds.has(task.id)) continue;
    const timestamp = new Date(task.completedAt);
    if (!Number.isFinite(timestamp.getTime())) continue;
    const date = task.dueDate ?? localDate(timestamp);
    if (!isInRetainedHistory(date, today)) continue;
    const group = completed.get(date) ?? [];
    group.push({ task, completionId: "", completedAt: task.completedAt });
    completed.set(date, group);
  }
  const dates = Array.from({ length }, (_, index) => addDays(start, index));
  return dates.map(date => ({
    date,
    due: (due.get(date) ?? []).sort(taskOrder),
    scheduled: (scheduled.get(date) ?? []).sort((a, b) => a.block.startInstant.localeCompare(b.block.startInstant)),
    completed: (completed.get(date) ?? []).filter(item =>
      !(scheduled.get(date) ?? []).some(entry => entry.completed && entry.task.id === item.task.id &&
        (!item.completionId || !entry.completionId || entry.completionId === item.completionId)))
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt) || taskOrder(a.task, b.task)),
  }));
}
export function overdueTasks(data: Data, today = localDate(new Date())): Task[] {
  return filterTasks(data, { completed: false })
    .filter(task => task.dueDate !== undefined && task.dueDate < today && isInRetainedHistory(task.dueDate, today))
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || taskOrder(a, b));
}

/** Permanently remove task history older than the rolling seven calendar days kept on the Dashboard. */
export function pruneExpiredHistory(data: Data, today = localDate(new Date())): Data {
  const cutoff = historyStart(today);
  const expiredTaskIds = new Set(data.tasks.filter(task => {
    if (task.dueDate && task.dueDate < cutoff) return true;
    if (task.deletedAt && localDate(new Date(task.deletedAt)) < cutoff) return true;
    if (!task.dueDate && task.completedAt) {
      const completedDay = localDate(new Date(task.completedAt));
      return completedDay < cutoff;
    }
    return false;
  }).map(task => task.id));
  const existingTaskIds = new Set(data.tasks.filter(task => !expiredTaskIds.has(task.id)).map(task => task.id));
  let changed = expiredTaskIds.size > 0;
  const stamp = new Date().toISOString();
  let detachedChild = false;
  const tasks = data.tasks.filter(task => !expiredTaskIds.has(task.id)).map(task => {
    const detached = task.parentTaskId && expiredTaskIds.has(task.parentTaskId);
    if (detached) detachedChild = true;
    return detached ? { ...task, parentTaskId: undefined, updatedAt: stamp, revision: task.revision + 1 } : task;
  });
  if (detachedChild) changed = true;

  const blocks = data.blocks.filter(block => {
    if (!existingTaskIds.has(block.taskId)) return false;
    if (block.deletedAt && localDate(new Date(block.deletedAt)) < cutoff) return false;
    try { return instantDay(block.startInstant, block.timeZone) >= cutoff; }
    catch { return true; }
  });
  if (blocks.length !== data.blocks.length) changed = true;

  const reminders = data.reminders.filter(reminder => existingTaskIds.has(reminder.taskId) &&
    !(reminder.deletedAt && localDate(new Date(reminder.deletedAt)) < cutoff));
  if (reminders.length !== data.reminders.length) changed = true;

  const completions = data.completions.filter(completion => {
    if (!existingTaskIds.has(completion.taskId)) return false;
    const completionDay = completion.occurrenceDate ?? localDate(new Date(completion.completedAt));
    return completionDay >= cutoff;
  });
  if (completions.length !== data.completions.length) changed = true;
  const retainedBlockIds = new Set(blocks.map(block => block.id));
  const compactedCompletions = completions.map(completion => {
    if (!completion.clearedBlockIds) return completion;
    const clearedBlockIds = completion.clearedBlockIds.filter(id => retainedBlockIds.has(id));
    if (clearedBlockIds.length === completion.clearedBlockIds.length) return completion;
    changed = true;
    return { ...completion, clearedBlockIds };
  });

  return changed ? { ...data, tasks, blocks, reminders, completions: compactedCompletions } : data;
}
export const taskOrder = (a: Task, b: Task): number =>
  a.sortKey - b.sortKey || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
export function reorderTask(data: Data, id: string, direction: -1 | 1): Data {
  const task = data.tasks.find(item => item.id === id);
  if (!task) return data;
  const group = data.tasks.filter(item => !item.deletedAt && item.projectId === task.projectId &&
    item.sectionId === task.sectionId && item.parentTaskId === task.parentTaskId).sort(taskOrder);
  const from = group.findIndex(item => item.id === id);
  const to = from + direction;
  if (to < 0 || to >= group.length) return data;
  group.splice(from, 1);
  group.splice(to, 0, task);
  const before = group[to - 1]?.sortKey;
  const after = group[to + 1]?.sortKey;
  const key = before === undefined ? (after ?? 0) - 1024 : after === undefined ? before + 1024 : (before + after) / 2;
  const stamp = new Date().toISOString();
  if (Number.isFinite(key) && key !== before && key !== after) {
    return { ...data, tasks: data.tasks.map(item => item.id === id ? { ...item, sortKey: key, updatedAt: stamp, revision: item.revision + 1 } : item) };
  }
  const positions = new Map(group.map((item, index) => [item.id, index * 1024]));
  return { ...data, tasks: data.tasks.map(item => positions.has(item.id) ? {
    ...item, sortKey: positions.get(item.id)!, updatedAt: stamp, revision: item.revision + 1
  } : item) };
}
function reorderEntities<T extends Entity & { sortKey: number }>(items: T[], id: string, direction: -1 | 1): T[] {
  const ordered = items.filter(item => !item.deletedAt).sort((a, b) =>
    a.sortKey - b.sortKey || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const from = ordered.findIndex(item => item.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ordered.length) return items;
  ordered.splice(to, 0, ordered.splice(from, 1)[0]);
  const stamp = new Date().toISOString();
  const before = ordered[to - 1]?.sortKey;
  const after = ordered[to + 1]?.sortKey;
  const key = before === undefined ? (after ?? 0) - 1024 : after === undefined ? before + 1024 : (before + after) / 2;
  if (Number.isFinite(key) && key !== before && key !== after) {
    return items.map(item => item.id === id ? { ...item, sortKey: key, updatedAt: stamp, revision: item.revision + 1 } : item);
  }
  // Extremely dense or colliding keys need a one-time rebalance.
  const positions = new Map(ordered.map((item, index) => [item.id, index * 1024]));
  return items.map(item => positions.has(item.id) && item.sortKey !== positions.get(item.id) ? {
    ...item, sortKey: positions.get(item.id)!, updatedAt: stamp, revision: item.revision + 1
  } : item);
}
export function reorderProject(data: Data, id: string, direction: -1 | 1): Data {
  if (!data.projects.some(project => project.id === id && !project.deletedAt && !project.archivedAt)) return data;
  const active = data.projects.filter(project => !project.deletedAt && !project.archivedAt);
  const reordered = reorderEntities(active, id, direction);
  if (reordered === active) return data;
  const changed = new Map(reordered.map(project => [project.id, project]));
  return { ...data, projects: data.projects.map(project => changed.get(project.id) ?? project) };
}
export function reorderSection(data: Data, id: string, direction: -1 | 1): Data {
  const section = data.sections.find(item => item.id === id && !item.deletedAt);
  if (!section) return data;
  const group = data.sections.filter(item => item.projectId === section.projectId && !item.deletedAt);
  const reordered = reorderEntities(group, id, direction);
  if (reordered === group) return data;
  const changed = new Map(reordered.map(item => [item.id, item]));
  return { ...data, sections: data.sections.map(item => changed.get(item.id) ?? item) };
}
export function deleteSection(data: Data, id: string): Data {
  const stamp = new Date().toISOString();
  return { ...data,
    sections: data.sections.map(section => section.id === id ? { ...section, deletedAt: stamp, updatedAt: stamp, revision: section.revision + 1 } : section),
    tasks: data.tasks.map(task => task.sectionId === id ? { ...task, sectionId: undefined, updatedAt: stamp, revision: task.revision + 1 } : task)
  };
}
export type DateScope = "overdue" | "today" | "upcoming" | "undated";
export type TaskFilter = { query?: string; projectId?: string | null; tagId?: string; priority?: Priority;
  completed?: boolean; dateScope?: DateScope; today?: string };
export function filterTasks(data: Data, filter: TaskFilter): Task[] {
  const query = filter.query?.trim().toLocaleLowerCase();
  const archived = new Set(data.projects.filter(project => project.archivedAt && !project.deletedAt).map(project => project.id));
  const today = filter.today ?? localDate(new Date());
  return data.tasks.filter(task => !task.deletedAt &&
    (!task.projectId || !archived.has(task.projectId)) &&
    (filter.completed === undefined || Boolean(task.completedAt) === filter.completed) &&
    (filter.projectId === null ? !task.projectId : !filter.projectId || task.projectId === filter.projectId) &&
    (!filter.tagId || task.tagIds.includes(filter.tagId)) &&
    (!filter.priority || task.priority === filter.priority) &&
    (!filter.dateScope || (filter.dateScope === "undated" ? !task.dueDate :
      Boolean(task.dueDate && (filter.dateScope === "today" ? task.dueDate === today :
        filter.dateScope === "overdue" ? task.dueDate < today && isInRetainedHistory(task.dueDate, today) : task.dueDate > today)))) &&
    (!query || `${task.title} ${task.notes}`.toLocaleLowerCase().includes(query))
  ).sort(taskOrder);
}
