CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`display_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`description` text,
	`created_at_utc_ms` integer NOT NULL,
	`storage_ref` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "attachments_mime_type_check" CHECK("attachments"."mime_type" IN ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "attachments_file_size_check" CHECK("attachments"."file_size_bytes" BETWEEN 1 AND 20971520)
);
--> statement-breakpoint
CREATE INDEX `attachments_task_created_idx` ON `attachments` (`task_id`,`created_at_utc_ms`);--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_storage_ref_idx` ON `attachments` (`storage_ref`);--> statement-breakpoint
CREATE TABLE `task_links` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`created_at_utc_ms` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_links_type_check" CHECK("task_links"."type" IN ('figma', 'external'))
);
--> statement-breakpoint
CREATE INDEX `task_links_task_created_idx` ON `task_links` (`task_id`,`created_at_utc_ms`);