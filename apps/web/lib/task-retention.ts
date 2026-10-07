import type { Data } from "./domain.ts";

export const ACCOUNT_PREFERENCES_ID = "00000000-0000-4000-8000-000000000002";
export const DEFAULT_COMPLETED_TASK_RETENTION_DAYS = 7;
export const MAX_COMPLETED_TASK_RETENTION_DAYS = 14;

export function completedTaskRetentionDays(data: Data): number {
  return data.preferences.find(item => item.id === ACCOUNT_PREFERENCES_ID && !item.deletedAt)?.completedTaskRetentionDays ?? DEFAULT_COMPLETED_TASK_RETENTION_DAYS;
}

export function setCompletedTaskRetentionDays(data: Data, days: number): Data {
  if (!Number.isInteger(days) || days < 1 || days > MAX_COMPLETED_TASK_RETENTION_DAYS) return data;
  const existing = data.preferences.find(item => item.id === ACCOUNT_PREFERENCES_ID);
  if (existing && !existing.deletedAt && existing.completedTaskRetentionDays === days) return data;
  const stamp = new Date().toISOString();
  const preference = { id: ACCOUNT_PREFERENCES_ID, createdAt: existing?.createdAt ?? stamp, updatedAt: stamp,
    revision: (existing?.revision ?? 0) + 1, completedTaskRetentionDays: days };
  return { ...data, preferences: [preference] };
}
