CREATE TABLE `holidays` (
	`work_date` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`created_at_utc_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `leave_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`work_date` text NOT NULL,
	`kind` text NOT NULL,
	`custom_minutes` integer,
	`status` text NOT NULL,
	`created_at_utc_ms` integer NOT NULL,
	`updated_at_utc_ms` integer NOT NULL,
	CONSTRAINT "leave_custom_minutes_check" CHECK("leave_entries"."custom_minutes" IS NULL OR "leave_entries"."custom_minutes" BETWEEN 1 AND 1440)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leave_group_date_idx` ON `leave_entries` (`group_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `leave_date_status_idx` ON `leave_entries` (`work_date`,`status`);--> statement-breakpoint
CREATE TABLE `monthly_commitment_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`commitment_id` text NOT NULL,
	`work_date` text NOT NULL,
	`schedule_version_id` text,
	`scheduled_minutes` integer NOT NULL,
	`approved_leave_minutes` integer NOT NULL,
	`target_minutes` integer NOT NULL,
	FOREIGN KEY (`commitment_id`) REFERENCES `monthly_commitments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_version_id`) REFERENCES `work_schedule_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_commitment_day_idx` ON `monthly_commitment_days` (`commitment_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `monthly_commitment_day_date_idx` ON `monthly_commitment_days` (`work_date`);--> statement-breakpoint
CREATE TABLE `monthly_commitments` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar` text NOT NULL,
	`period_key` text NOT NULL,
	`period_start_work_date` text NOT NULL,
	`period_end_work_date` text NOT NULL,
	`revision` integer NOT NULL,
	`target_minutes` integer NOT NULL,
	`override_minutes` integer,
	`is_current` integer DEFAULT true NOT NULL,
	`created_at_utc_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_commitment_revision_idx` ON `monthly_commitments` (`calendar`,`period_key`,`revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_commitment_current_idx` ON `monthly_commitments` (`calendar`,`period_key`) WHERE "monthly_commitments"."is_current" = 1;--> statement-breakpoint
CREATE INDEX `monthly_commitment_range_idx` ON `monthly_commitments` (`period_start_work_date`,`period_end_work_date`);--> statement-breakpoint
CREATE TABLE `work_date_boundary_overrides` (
	`work_date` text PRIMARY KEY NOT NULL,
	`boundary_minutes` integer NOT NULL,
	`updated_at_utc_ms` integer NOT NULL,
	CONSTRAINT "work_date_boundary_override_check" CHECK("work_date_boundary_overrides"."boundary_minutes" BETWEEN 0 AND 1439)
);
--> statement-breakpoint
CREATE TABLE `work_date_overrides` (
	`work_date` text PRIMARY KEY NOT NULL,
	`target_minutes` integer NOT NULL,
	`updated_at_utc_ms` integer NOT NULL,
	CONSTRAINT "work_date_override_minutes_check" CHECK("work_date_overrides"."target_minutes" BETWEEN 0 AND 1440)
);
--> statement-breakpoint
CREATE TABLE `work_schedule_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`effective_from_work_date` text NOT NULL,
	`time_zone_id` text NOT NULL,
	`work_date_boundary_minutes` integer NOT NULL,
	`daily_commitment_minutes` integer NOT NULL,
	`working_weekdays_json` text NOT NULL,
	`created_at_utc_ms` integer NOT NULL,
	CONSTRAINT "work_schedule_boundary_check" CHECK("work_schedule_versions"."work_date_boundary_minutes" BETWEEN 0 AND 1439),
	CONSTRAINT "work_schedule_daily_check" CHECK("work_schedule_versions"."daily_commitment_minutes" BETWEEN 0 AND 1440)
);
--> statement-breakpoint
CREATE INDEX `work_schedule_effective_idx` ON `work_schedule_versions` (`effective_from_work_date`);