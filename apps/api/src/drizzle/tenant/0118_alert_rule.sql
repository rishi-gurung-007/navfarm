-- Alerts and Notifications Master (feed workbook, Master Setup §4; spec Plan
-- B). Columns are §4's fields in order. farm_id NULL is the workbook's
-- "ALL". Checkpoint 10: every threshold, recipient, channel and escalation
-- lives here, not in code.
CREATE TABLE `alert_rule` (
  `rule_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `notification_code` varchar(20) NOT NULL,
  `notification_name` varchar(100) NOT NULL,
  `event_type` varchar(40) NOT NULL,
  `trigger_entity` varchar(20) NOT NULL,
  `threshold_reference` varchar(20) NOT NULL DEFAULT 'FIXED_VALUE',
  `threshold_value` decimal(18,4),
  `priority_level` varchar(30) NOT NULL,
  `recipient_roles` json NOT NULL,
  `delivery_channel` varchar(30) NOT NULL DEFAULT 'IN_APP',
  `frequency` varchar(20) NOT NULL DEFAULT 'ONCE',
  `escalation_after_hours` int,
  `escalation_role` varchar(50),
  `farm_id` varchar(36),
  `is_active` boolean NOT NULL DEFAULT true,
  `status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `alert_rule_rule_id` PRIMARY KEY(`rule_id`),
  CONSTRAINT `uq_alert_rule_code` UNIQUE(`tenant_id`,`company_id`,`notification_code`)
);
--> statement-breakpoint
ALTER TABLE `alert_rule` ADD CONSTRAINT `alert_rule_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `alert_rule` ADD CONSTRAINT `alert_rule_farm_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE set null;
--> statement-breakpoint
-- Seed, per company, the workbook's own rules. FEED-BELOW-L1 is §4 column F
-- verbatim (CRITICAL_FIRST_PRIORITY, FARM_MANAGER, ONCE until resolved and
-- escalate after 4 hours to HEAD_OF_FARM, i.e. ESCALATING). FEED-ABOVE is
-- checkpoint 13 (INFO). DIET-CHANGE is checkpoint 30 (3 days, WARNING).
-- REQ-OVERDUE is §4 row 43's example code with checkpoint 20's Saturday
-- CRITICAL to Farm Manager and Head of Farm; REQ-REMINDER (code and name
-- ours) is its Friday reminder (Q6). The role codes are the workbook's; no
-- tenant has them yet (Q1). Email is not delivered, so IN_APP only (Q12).
INSERT INTO `alert_rule` (`rule_id`,`tenant_id`,`company_id`,`notification_code`,`notification_name`,`event_type`,`trigger_entity`,`threshold_reference`,`threshold_value`,`priority_level`,`recipient_roles`,`delivery_channel`,`frequency`,`escalation_after_hours`,`escalation_role`)
SELECT UUID(), c.`tenant_id`, c.`company_id`, 'FEED-BELOW-L1', 'Low silo feed, first priority', 'FEED_BELOW_L1', 'SILO', 'SILO_BELOW', NULL, 'CRITICAL_FIRST_PRIORITY', JSON_ARRAY('FARM_MANAGER'), 'IN_APP', 'ESCALATING', 4, 'HEAD_OF_FARM' FROM `company_master` c
UNION ALL
SELECT UUID(), c.`tenant_id`, c.`company_id`, 'FEED-ABOVE', 'Silo feed above high level, do not order', 'FEED_ABOVE', 'SILO', 'SILO_ABOVE', NULL, 'INFO', JSON_ARRAY('FARM_MANAGER'), 'IN_APP', 'ONCE', NULL, NULL FROM `company_master` c
UNION ALL
SELECT UUID(), c.`tenant_id`, c.`company_id`, 'DIET-CHANGE', 'Diet change within 3 days', 'DIET_CHANGE', 'FEED_PLAN', 'FIXED_VALUE', 3, 'WARNING', JSON_ARRAY('FARM_MANAGER'), 'IN_APP', 'ONCE', NULL, NULL FROM `company_master` c
UNION ALL
SELECT UUID(), c.`tenant_id`, c.`company_id`, 'REQ-REMINDER', 'Requisition not yet approved', 'REQ_DEADLINE', 'REQUISITION', 'FIXED_VALUE', 1, 'WARNING', JSON_ARRAY('FARM_MANAGER'), 'IN_APP', 'ONCE', NULL, NULL FROM `company_master` c
UNION ALL
SELECT UUID(), c.`tenant_id`, c.`company_id`, 'REQ-OVERDUE', 'Requisition deadline reached', 'REQ_DEADLINE', 'REQUISITION', 'FIXED_VALUE', 0, 'CRITICAL', JSON_ARRAY('FARM_MANAGER','HEAD_OF_FARM'), 'IN_APP', 'ONCE', NULL, NULL FROM `company_master` c;
