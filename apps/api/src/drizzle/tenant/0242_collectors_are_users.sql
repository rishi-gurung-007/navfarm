-- Semen collectors are people, and people live in User Management: a collector is a user who holds the SEMEN_COLLECTOR role.
-- The Semen Collector master goes. A collector named on a result or a plan line now points at the user. A master row
-- with no linked user (user_id) has no one to point at, so the boar's result / plan line keeps no collector.
ALTER TABLE `semen_boar_result` DROP FOREIGN KEY `semen_boar_result_collector_id_semen_collector_collector_id_fk`;
--> statement-breakpoint
ALTER TABLE `semen_collection_plan_line` DROP FOREIGN KEY `fk_scpl_collector`;
--> statement-breakpoint
UPDATE `semen_boar_result` r LEFT JOIN `semen_collector` c ON c.`collector_id` = r.`collector_id` SET r.`collector_id` = c.`user_id` WHERE r.`collector_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `semen_collection_plan_line` l LEFT JOIN `semen_collector` c ON c.`collector_id` = l.`collector_id` SET l.`collector_id` = c.`user_id` WHERE l.`collector_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `semen_boar_result` r LEFT JOIN `user_master` u ON u.`user_id` = r.`collector_id` SET r.`collector_id` = NULL WHERE r.`collector_id` IS NOT NULL AND u.`user_id` IS NULL;
--> statement-breakpoint
UPDATE `semen_collection_plan_line` l LEFT JOIN `user_master` u ON u.`user_id` = l.`collector_id` SET l.`collector_id` = NULL WHERE l.`collector_id` IS NOT NULL AND u.`user_id` IS NULL;
--> statement-breakpoint
ALTER TABLE `semen_boar_result` ADD CONSTRAINT `semen_boar_result_collector_id_user_master_user_id_fk` FOREIGN KEY (`collector_id`) REFERENCES `user_master`(`user_id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `semen_collection_plan_line` ADD CONSTRAINT `fk_scpl_collector` FOREIGN KEY (`collector_id`) REFERENCES `user_master`(`user_id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
DROP TABLE `semen_collector`;
--> statement-breakpoint
INSERT INTO `role_master` (`role_id`, `company_id`, `role_code`, `role_name`, `role_description`, `is_system_role`, `is_active`)
SELECT UUID(), c.`company_id`, 'SEMEN_COLLECTOR', 'Semen Collector', 'Collects semen at the AI Station; can be named on a collection plan and a collection', 1, 1
FROM `company_master` c
WHERE NOT EXISTS (SELECT 1 FROM `role_master` r WHERE r.`company_id` = c.`company_id` AND r.`role_code` = 'SEMEN_COLLECTOR');
