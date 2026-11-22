CREATE TABLE `app_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`daily_commitment_minutes` integer DEFAULT 480 NOT NULL,
	`working_weekdays_json` text DEFAULT '[6,7,1,2,3,4]' NOT NULL,
	`weekly_holiday_iso_day` integer DEFAULT 5 NOT NULL,
	`work_date_boundary_minutes` integer DEFAULT 360 NOT NULL,
	`calendar` text DEFAULT 'jalali' NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`timezone_id` text NOT NULL,
	`onboarding_completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "app_settings_singleton_check" CHECK("app_settings"."id" = 1),
	CONSTRAINT "app_settings_daily_commitment_check" CHECK("app_settings"."daily_commitment_minutes" BETWEEN 15 AND 1440),
	CONSTRAINT "app_settings_weekday_check" CHECK("app_settings"."weekly_holiday_iso_day" BETWEEN 1 AND 7),
	CONSTRAINT "app_settings_boundary_check" CHECK("app_settings"."work_date_boundary_minutes" BETWEEN 0 AND 1439)
);
--> statement-breakpoint
CREATE TABLE `user_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`job_title` text DEFAULT 'Product Designer' NOT NULL,
	`updated_at` integer NOT NULL
);
