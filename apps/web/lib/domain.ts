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
  tasks: Task[];
  projects: Project[];
  sections: ProjectSection[];
  tags: Tag[];
  blocks: ScheduledBlock[];
  reminders: Reminder[];
  completions: Completion[];
};
export const emptyData = (): Data => ({
  schemaVersion: 1, tasks: [], projects: [], sections: [], tags: [], blocks: [], reminders: [], completions: []
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
export function saveTask(data: Data, task: Task, start = "", end = "", reminderMinutes = ""): Data {
  const stamp = new Date().toISOString();
  const oldTask = data.tasks.find(item => item.id === task.id);
  const currentBlock = data.blocks.find(block => block.taskId === task.id && !block.deletedAt);
  const currentReminder = data.reminders.find(reminder => reminder.taskId === task.id && !reminder.deletedAt);
  const hasBlock = Boolean(start && end && new Date(end) > new Date(start));
  const hasReminder = reminderMinutes !== "" && Boolean(task.dueDate && task.dueTime);
  const nextBlock: ScheduledBlock | undefined = hasBlock ? {
    ...(currentBlock ?? newEntity()), taskId: task.id, startInstant: new Date(start).toISOString(),
    endInstant: new Date(end).toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    updatedAt: stamp, revision: currentBlock ? currentBlock.revision + 1 : 1
  } : undefined;
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
    blocks: [
      ...data.blocks.map(block => block.id === currentBlock?.id ? nextBlock ?? { ...block, deletedAt: stamp, updatedAt: stamp, revision: block.revision + 1 } : block),
      ...(nextBlock && !currentBlock ? [nextBlock] : [])
    ],
    reminders: [
      ...data.reminders.map(reminder => reminder.id === currentReminder?.id ? nextReminder ?? { ...reminder, deletedAt: stamp, updatedAt: stamp, revision: reminder.revision + 1 } : reminder),
      ...(nextReminder && !currentReminder ? [nextReminder] : [])
    ]
  };
}
export function dashboardDays(data: Data, start: string, length: number) {
  const active = data.tasks.filter(task => !task.deletedAt && !task.completedAt);
  const byId = new Map(active.map(task => [task.id, task]));
  const due = new Map<string, Task[]>();
  for (const task of active) {
    if (!task.dueDate) continue;
    const group = due.get(task.dueDate) ?? [];
    group.push(task);
    due.set(task.dueDate, group);
  }
  const scheduled = new Map<string, { block: ScheduledBlock; task: Task }[]>();
  for (const block of data.blocks) {
    const task = byId.get(block.taskId);
    if (block.deletedAt || !task) continue;
    const date = instantDay(block.startInstant, block.timeZone);
    const group = scheduled.get(date) ?? [];
    group.push({ block, task });
    scheduled.set(date, group);
  }
  const dates = Array.from({ length }, (_, index) => addDays(start, index));
  return dates.map(date => ({
    date,
    due: (due.get(date) ?? []).sort(taskOrder),
    scheduled: (scheduled.get(date) ?? []).sort((a, b) => a.block.startInstant.localeCompare(b.block.startInstant)),
    overdue: date === localDate(new Date()) ? active.filter(task => task.dueDate && task.dueDate < date).sort(taskOrder) : []
  }));
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
export function deleteSection(data: Data, id: string): Data {
  const stamp = new Date().toISOString();
  return { ...data,
    sections: data.sections.map(section => section.id === id ? { ...section, deletedAt: stamp, updatedAt: stamp, revision: section.revision + 1 } : section),
    tasks: data.tasks.map(task => task.sectionId === id ? { ...task, sectionId: undefined, updatedAt: stamp, revision: task.revision + 1 } : task)
  };
}
export type TaskFilter = { query?: string; projectId?: string; tagId?: string; priority?: Priority; completed?: boolean };
export function filterTasks(data: Data, filter: TaskFilter): Task[] {
  const query = filter.query?.trim().toLocaleLowerCase();
  return data.tasks.filter(task => !task.deletedAt &&
    (filter.completed === undefined || Boolean(task.completedAt) === filter.completed) &&
    (!filter.projectId || task.projectId === filter.projectId) &&
    (!filter.tagId || task.tagIds.includes(filter.tagId)) &&
    (!filter.priority || task.priority === filter.priority) &&
    (!query || `${task.title} ${task.notes}`.toLocaleLowerCase().includes(query))
  ).sort(taskOrder);
}
