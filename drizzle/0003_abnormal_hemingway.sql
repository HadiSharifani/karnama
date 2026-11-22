PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_work_schedule_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`effective_from_work_date` text NOT NULL,
	`time_zone_id` text NOT NULL,
	`work_date_boundary_minutes` integer NOT NULL,
	`daily_commitment_minutes` integer NOT NULL,
	`weekly_holiday_iso_day` integer NOT NULL,
	`working_weekdays_json` text NOT NULL,
	`created_at_utc_ms` integer NOT NULL,
	CONSTRAINT "work_schedule_boundary_check" CHECK("__new_work_schedule_versions"."work_date_boundary_minutes" BETWEEN 0 AND 1439),
	CONSTRAINT "work_schedule_daily_check" CHECK("__new_work_schedule_versions"."daily_commitment_minutes" BETWEEN 0 AND 1440),
	CONSTRAINT "work_schedule_holiday_check" CHECK("__new_work_schedule_versions"."weekly_holiday_iso_day" BETWEEN 1 AND 7)
);
--> statement-breakpoint
INSERT INTO `__new_work_schedule_versions`(
	`id`, `effective_from_work_date`, `time_zone_id`, `work_date_boundary_minutes`,
	`daily_commitment_minutes`, `weekly_holiday_iso_day`, `working_weekdays_json`, `created_at_utc_ms`
)
SELECT
	`id`, `effective_from_work_date`, `time_zone_id`, `work_date_boundary_minutes`,
	`daily_commitment_minutes`,
	COALESCE((SELECT `weekly_holiday_iso_day` FROM `app_settings` WHERE `id` = 1), 5),
	`working_weekdays_json`, `created_at_utc_ms`
FROM `work_schedule_versions`;
--> statement-breakpoint
DROP TABLE `work_schedule_versions`;
--> statement-breakpoint
ALTER TABLE `__new_work_schedule_versions` RENAME TO `work_schedule_versions`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE INDEX `work_schedule_effective_idx` ON `work_schedule_versions` (`effective_from_work_date`);
