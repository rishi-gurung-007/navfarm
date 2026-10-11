-- Feed scheduler (brief B; Engine row 69, Feed Forecast row 8). Additive only:
-- the tentative Feed Plan run day and time join the other Feed Planning Settings
-- as nullable columns (no built-in day or time), and feed_schedule_log records each
-- scheduler run so a job runs once per farm and period.
ALTER TABLE `feed_planning_setting` ADD `tentative_plan_weekday` int;--> statement-breakpoint
ALTER TABLE `feed_planning_setting` ADD `tentative_plan_time` varchar(5);--> statement-breakpoint
CREATE TABLE `feed_schedule_log` (
	`run_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`farm_id` varchar(36),
	`job_code` varchar(30) NOT NULL,
	`trigger_type` varchar(20) NOT NULL,
	`period_key` varchar(20) NOT NULL,
	`run_key` varchar(191),
	`status` varchar(20) NOT NULL DEFAULT 'RUNNING',
	`summary` json,
	`error_message` text,
	`started_at` timestamp NOT NULL,
	`finished_at` timestamp,
	`triggered_by` varchar(36),
	CONSTRAINT `feed_schedule_log_run_id` PRIMARY KEY(`run_id`),
	CONSTRAINT `uq_feed_schedule_log_run_key` UNIQUE(`run_key`)
);
--> statement-breakpoint
CREATE INDEX `idx_feed_schedule_log_job` ON `feed_schedule_log` (`tenant_id`,`job_code`,`started_at`);
