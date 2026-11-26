import { sql, type SQLWrapper } from 'drizzle-orm'

/** Include unassigned work and work whose linked task is currently active. */
export function activeTaskTimeCondition(
  taskId: SQLWrapper,
  joinedTaskId: SQLWrapper,
  archivedAtUtcMs: SQLWrapper
) {
  return sql`(${taskId} IS NULL OR (${joinedTaskId} IS NOT NULL AND ${archivedAtUtcMs} IS NULL))`
}
