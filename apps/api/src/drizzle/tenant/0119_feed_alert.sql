-- In-app feed alerts (Plan B; Master Setup §4, checkpoints 11–13, 20, 30).
-- One row per raised alert. active_key carries the dedup key while the alert
-- is ACTIVE and NULL once RESOLVED, so the unique index allows exactly one
-- open alert per rule and subject (checkpoint 11 "Deduplicate until
-- recovery") while keeping every resolved one as history (checkpoint 12's
-- re-arm raises a new row).
CREATE TABLE `feed_alert` (
  `alert_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `farm_id` varchar(36) NOT NULL,
  `rule_id` varchar(36) NOT NULL,
  `notification_code` varchar(20) NOT NULL,
  `event_type` varchar(40) NOT NULL,
  `priority_level` varchar(30) NOT NULL,
  `subject_type` varchar(20) NOT NULL,
  `subject_id` varchar(36) NOT NULL,
  `item_id` varchar(36),
  `dedup_key` varchar(191) NOT NULL,
  `active_key` varchar(191),
  `status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
  `title` varchar(200) NOT NULL,
  `message` text NOT NULL,
  `observed_value` decimal(18,4),
  `threshold_value` decimal(18,4),
  `recipient_roles` json NOT NULL,
  `escalation_role` varchar(50),
  `escalated_at` timestamp NULL,
  `acknowledged_by` varchar(36),
  `acknowledged_at` timestamp NULL,
  `raised_at` timestamp NOT NULL,
  `last_notified_at` timestamp NOT NULL,
  `notify_count` int NOT NULL DEFAULT 1,
  `resolved_at` timestamp NULL,
  `resolved_reason` varchar(20),
  CONSTRAINT `feed_alert_alert_id` PRIMARY KEY(`alert_id`),
  CONSTRAINT `uq_feed_alert_active_key` UNIQUE(`active_key`)
);
--> statement-breakpoint
ALTER TABLE `feed_alert` ADD CONSTRAINT `feed_alert_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `feed_alert` ADD CONSTRAINT `feed_alert_farm_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `feed_alert` ADD CONSTRAINT `feed_alert_rule_fk` FOREIGN KEY (`rule_id`) REFERENCES `alert_rule`(`rule_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_feed_alert_farm_status` ON `feed_alert` (`farm_id`, `status`);
