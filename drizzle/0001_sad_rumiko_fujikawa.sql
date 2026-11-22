CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`estimated_duration_minutes` integer,
	`created_at_utc_ms` integer NOT NULL,
	`updated_at_utc_ms` integer NOT NULL,
	`completed_at_utc_ms` integer,
	`archived_at_utc_ms` integer,
	CONSTRAINT "tasks_status_check" CHECK("tasks"."status" IN ('todo', 'in_progress', 'waiting_feedback', 'on_hold', 'done')),
	CONSTRAINT "tasks_priority_check" CHECK("tasks"."priority" IN ('low', 'medium', 'high')),
	CONSTRAINT "tasks_estimated_duration_check" CHECK("tasks"."estimated_duration_minutes" IS NULL OR "tasks"."estimated_duration_minutes" BETWEEN 1 AND 1000000)
);
--> statement-breakpoint
CREATE INDEX `tasks_archive_updated_idx` ON `tasks` (`archived_at_utc_ms`,`updated_at_utc_ms`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE TABLE `timer_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at_utc_ms` integer NOT NULL,
	`current_segment_started_at_utc_ms` integer,
	`checkpoint_at_utc_ms` integer,
	`time_zone_id` text NOT NULL,
	`work_date_boundary_minutes` integer NOT NULL,
	`recovery_start_utc_ms` integer,
	`recovery_end_utc_ms` integer,
	`recovery_reviewed_at_utc_ms` integer,
	`created_at_utc_ms` integer NOT NULL,
	`updated_at_utc_ms` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "timer_runs_status_check" CHECK("timer_runs"."status" IN ('running', 'paused', 'stopped')),
	CONSTRAINT "timer_runs_boundary_check" CHECK("timer_runs"."work_date_boundary_minutes" BETWEEN 0 AND 1439),
	CONSTRAINT "timer_runs_recovery_range_check" CHECK("timer_runs"."recovery_start_utc_ms" IS NULL OR ("timer_runs"."recovery_end_utc_ms" IS NOT NULL AND "timer_runs"."recovery_end_utc_ms" >= "timer_runs"."recovery_start_utc_ms"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `timer_one_running_idx` ON `timer_runs` (`status`) WHERE "timer_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX `timer_runs_status_updated_idx` ON `timer_runs` (`status`,`updated_at_utc_ms`);--> statement-breakpoint
CREATE TABLE `work_date_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`segment_index` integer NOT NULL,
	`start_utc_ms` integer NOT NULL,
	`end_utc_ms` integer NOT NULL,
	`work_date` text NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `work_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "work_date_allocation_range_check" CHECK("work_date_allocations"."end_utc_ms" > "work_date_allocations"."start_utc_ms"),
	CONSTRAINT "work_date_allocation_segment_check" CHECK("work_date_allocations"."segment_index" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `work_date_allocation_session_segment_idx` ON `work_date_allocations` (`session_id`,`segment_index`);--> statement-breakpoint
CREATE INDEX `work_date_allocations_date_idx` ON `work_date_allocations` (`work_date`);--> statement-breakpoint
CREATE TABLE `work_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`timer_run_id` text,
	`source` text NOT NULL,
	`start_utc_ms` integer NOT NULL,
	`end_utc_ms` integer NOT NULL,
	`time_zone_id` text NOT NULL,
	`work_date_boundary_minutes` integer NOT NULL,
	`allocation_mode` text DEFAULT 'boundary' NOT NULL,
	`created_at_utc_ms` integer NOT NULL,
	`updated_at_utc_ms` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`timer_run_id`) REFERENCES `timer_runs`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "work_sessions_time_check" CHECK("work_sessions"."end_utc_ms" > "work_sessions"."start_utc_ms"),
	CONSTRAINT "work_sessions_boundary_check" CHECK("work_sessions"."work_date_boundary_minutes" BETWEEN 0 AND 1439)
);
--> statement-breakpoint
CREATE INDEX `work_sessions_range_idx` ON `work_sessions` (`start_utc_ms`,`end_utc_ms`);--> statement-breakpoint
CREATE INDEX `work_sessions_task_start_idx` ON `work_sessions` (`task_id`,`start_utc_ms`);--> statement-breakpoint
CREATE INDEX `work_sessions_timer_run_idx` ON `work_sessions` (`timer_run_id`);