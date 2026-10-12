-- Pack numbers from a number series (audit I3). They were MAX(pack_no)+1 read at insert time, so two packs created at
-- once could take the same number. A QR_PACK series is created like every other — a tenant template row and one row per
-- company — and each company's counter starts after its highest existing pack, so the numbers already printed carry on.
-- Same shape as ITEM_LOT (prefix, separator, NEVER reset). Idempotent: a row that already exists is left alone.
INSERT INTO `no_series` (`id`, `tenant_id`, `company_id`, `code`, `description`, `master_type`, `no_series_code`, `seq_length`, `increment_by`, `is_default`, `manual_nos`, `last_no_used`, `blocked`, `document_type`, `prefix`, `separator`, `current_seq`, `reset_frequency`, `prefix_position`)
SELECT UUID(), t.`tenant_id`, NULL, 'QR_PACK', 'QR Pack Number Series', 'QR_PACK', 'PACK', 6, 1, 1, 0, NULL, 0, 'QR_PACK', 'PACK', '-', 0, 'NEVER', 'END'
FROM (SELECT DISTINCT `tenant_id` FROM `company_master`) t
WHERE NOT EXISTS (SELECT 1 FROM `no_series` n WHERE n.`tenant_id` = t.`tenant_id` AND n.`company_id` IS NULL AND n.`code` = 'QR_PACK');
--> statement-breakpoint
INSERT INTO `no_series` (`id`, `tenant_id`, `company_id`, `code`, `description`, `master_type`, `no_series_code`, `seq_length`, `increment_by`, `is_default`, `manual_nos`, `last_no_used`, `blocked`, `document_type`, `prefix`, `separator`, `current_seq`, `reset_frequency`, `prefix_position`)
SELECT UUID(), c.`tenant_id`, c.`company_id`, 'QR_PACK', 'QR Pack Number Series', 'QR_PACK', 'PACK', 6, 1, 1, 0,
  (SELECT MAX(q.`pack_no`) FROM `qr_code_master` q WHERE q.`company_id` = c.`company_id` AND q.`pack_no` LIKE 'PACK-%'),
  0, 'QR_PACK', 'PACK', '-',
  COALESCE((SELECT MAX(CAST(SUBSTRING(q.`pack_no`, 6) AS UNSIGNED)) FROM `qr_code_master` q WHERE q.`company_id` = c.`company_id` AND q.`pack_no` LIKE 'PACK-%'), 0),
  'NEVER', 'END'
FROM `company_master` c
WHERE NOT EXISTS (SELECT 1 FROM `no_series` n WHERE n.`tenant_id` = c.`tenant_id` AND n.`company_id` = c.`company_id` AND n.`code` = 'QR_PACK');
