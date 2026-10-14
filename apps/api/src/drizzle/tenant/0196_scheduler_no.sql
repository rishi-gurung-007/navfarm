-- 13 Oct 2026 (Arun; numbered 0196 on merge, 14 Oct — 0194 and 0195 were taken): a scheduler is shown and quoted by a readable number (SCH-000001) instead of its UUID. The UUID stays
-- the key. Numbers come from a SCHEDULER series, one per company like every other series (template row + one per
-- company). Existing schedulers are numbered per company in the order they were created, and each company's counter
-- carries on after them. Additive. The series inserts skip a series that already exists, and the numbering skips a
-- scheduler that already has a number.
ALTER TABLE `scheduler_header` ADD `scheduler_no` varchar(30);
--> statement-breakpoint
UPDATE `scheduler_header` s
JOIN (
  SELECT `scheduler_id`, ROW_NUMBER() OVER (PARTITION BY `company_id` ORDER BY `created_at`, `scheduler_id`) AS rn
  FROM `scheduler_header`
) x ON x.`scheduler_id` = s.`scheduler_id`
SET s.`scheduler_no` = CONCAT('SCH-', LPAD(x.rn, 6, '0'))
WHERE s.`scheduler_no` IS NULL;
--> statement-breakpoint
ALTER TABLE `scheduler_header` ADD CONSTRAINT `uq_scheduler_header_company_no` UNIQUE (`company_id`, `scheduler_no`);
--> statement-breakpoint
INSERT INTO `no_series` (`id`, `tenant_id`, `company_id`, `code`, `description`, `master_type`, `no_series_code`, `seq_length`, `increment_by`, `is_default`, `manual_nos`, `last_no_used`, `blocked`, `document_type`, `prefix`, `separator`, `current_seq`, `reset_frequency`, `prefix_position`)
SELECT UUID(), t.`tenant_id`, NULL, 'SCHEDULER', 'Scheduler Number', 'SCHEDULER', 'SCH', 6, 1, 1, 0, NULL, 0, 'SCHEDULER', 'SCH', '-', 0, 'NEVER', 'END'
FROM (SELECT DISTINCT `tenant_id` FROM `company_master`) t
WHERE NOT EXISTS (SELECT 1 FROM `no_series` n WHERE n.`tenant_id` = t.`tenant_id` AND n.`company_id` IS NULL AND n.`code` = 'SCHEDULER');
--> statement-breakpoint
INSERT INTO `no_series` (`id`, `tenant_id`, `company_id`, `code`, `description`, `master_type`, `no_series_code`, `seq_length`, `increment_by`, `is_default`, `manual_nos`, `last_no_used`, `blocked`, `document_type`, `prefix`, `separator`, `current_seq`, `reset_frequency`, `prefix_position`)
SELECT UUID(), c.`tenant_id`, c.`company_id`, 'SCHEDULER', 'Scheduler Number', 'SCHEDULER', 'SCH', 6, 1, 1, 0,
  (SELECT MAX(s.`scheduler_no`) FROM `scheduler_header` s WHERE s.`company_id` = c.`company_id` AND s.`scheduler_no` LIKE 'SCH-%'),
  0, 'SCHEDULER', 'SCH', '-',
  COALESCE((SELECT MAX(CAST(SUBSTRING(s.`scheduler_no`, 5) AS UNSIGNED)) FROM `scheduler_header` s WHERE s.`company_id` = c.`company_id` AND s.`scheduler_no` LIKE 'SCH-%'), 0),
  'NEVER', 'END'
FROM `company_master` c
WHERE NOT EXISTS (SELECT 1 FROM `no_series` n WHERE n.`tenant_id` = c.`tenant_id` AND n.`company_id` = c.`company_id` AND n.`code` = 'SCHEDULER');
