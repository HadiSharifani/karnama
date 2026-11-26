ALTER TABLE `tasks` ADD COLUMN `position` integer DEFAULT 0 NOT NULL CHECK (`position` >= 0);
--> statement-breakpoint
UPDATE `tasks` AS `task`
SET `position` = (
	SELECT count(*)
	FROM `tasks` AS `previous`
	WHERE `previous`.`status` = `task`.`status`
		AND (
			`previous`.`created_at_utc_ms` < `task`.`created_at_utc_ms`
			OR (
				`previous`.`created_at_utc_ms` = `task`.`created_at_utc_ms`
				AND `previous`.`id` < `task`.`id`
			)
		)
);
--> statement-breakpoint
CREATE INDEX `tasks_board_position_idx` ON `tasks` (`status`, `archived_at_utc_ms`, `position`);
