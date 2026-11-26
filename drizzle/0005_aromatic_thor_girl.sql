CREATE TABLE `report_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`report_type` text NOT NULL,
	`calendar` text NOT NULL,
	`period_key` text NOT NULL,
	`period_start_work_date` text NOT NULL,
	`period_end_work_date` text NOT NULL,
	`format` text NOT NULL,
	`generated_at_utc_ms` integer NOT NULL,
	`payload_json` text NOT NULL,
	CONSTRAINT "report_snapshots_type_check" CHECK("report_snapshots"."report_type" IN ('company', 'personal')),
	CONSTRAINT "report_snapshots_calendar_check" CHECK("report_snapshots"."calendar" IN ('jalali', 'gregorian')),
	CONSTRAINT "report_snapshots_format_check" CHECK("report_snapshots"."format" IN ('pdf', 'html')),
	CONSTRAINT "report_snapshots_period_check" CHECK("report_snapshots"."period_start_work_date" <= "report_snapshots"."period_end_work_date")
);
--> statement-breakpoint
CREATE INDEX `report_snapshots_period_created_idx` ON `report_snapshots` (`calendar`,`period_key`,`generated_at_utc_ms`);