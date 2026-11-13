-- 13 Nov 2026 (plan 2026-11-13-posting-group-setup): accounts are set once in a Posting Group and an item picks one.
-- BIOLOGICAL groups hold the six animal accounts; INVENTORY groups hold the stock and cost-of-sales accounts. The item keeps a copy of
-- its group's accounts in its own columns (the posting paths still read those), kept in step by the API.
-- A stray gl_posting_group of an earlier, reverted design may exist (no code or migration owned it): it is replaced.
-- (written without backticks: the drift spec reads a backticked DROP as dropping the table this file creates)
DROP TABLE IF EXISTS gl_posting_group;
--> statement-breakpoint
CREATE TABLE `gl_posting_group` (
  `posting_group_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `group_code` varchar(50) NOT NULL,
  `group_name` varchar(150) NOT NULL,
  `kind` varchar(20) NOT NULL,
  `asset_gl_id` varchar(36) DEFAULT NULL,
  `accum_amort_gl_id` varchar(36) DEFAULT NULL,
  `amort_expense_gl_id` varchar(36) DEFAULT NULL,
  `fv_gain_gl_id` varchar(36) DEFAULT NULL,
  `fv_loss_gl_id` varchar(36) DEFAULT NULL,
  `writeoff_gl_id` varchar(36) DEFAULT NULL,
  `inventory_gl_id` varchar(36) DEFAULT NULL,
  `cogs_gl_id` varchar(36) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
  `created_by` varchar(36) DEFAULT NULL,
  `updated_by` varchar(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`posting_group_id`),
  UNIQUE KEY `uq_gl_posting_group_code` (`tenant_id`,`company_id`,`group_code`),
  KEY `gl_pg_company_id_fk` (`company_id`),
  CONSTRAINT `gl_pg_company_id_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master` (`company_id`) ON DELETE RESTRICT,
  CONSTRAINT `gl_pg_asset_gl_fk` FOREIGN KEY (`asset_gl_id`) REFERENCES `gl_account_master` (`gl_account_id`) ON DELETE RESTRICT,
  CONSTRAINT `gl_pg_accum_gl_fk` FOREIGN KEY (`accum_amort_gl_id`) REFERENCES `gl_account_master` (`gl_account_id`) ON DELETE RESTRICT,
  CONSTRAINT `gl_pg_amort_gl_fk` FOREIGN KEY (`amort_expense_gl_id`) REFERENCES `gl_account_master` (`gl_account_id`) ON DELETE RESTRICT,
  CONSTRAINT `gl_pg_fv_gain_gl_fk` FOREIGN KEY (`fv_gain_gl_id`) REFERENCES `gl_account_master` (`gl_account_id`) ON DELETE RESTRICT,
  CONSTRAINT `gl_pg_fv_loss_gl_fk` FOREIGN KEY (`fv_loss_gl_id`) REFERENCES `gl_account_master` (`gl_account_id`) ON DELETE RESTRICT,
  CONSTRAINT `gl_pg_writeoff_gl_fk` FOREIGN KEY (`writeoff_gl_id`) REFERENCES `gl_account_master` (`gl_account_id`) ON DELETE RESTRICT,
  CONSTRAINT `gl_pg_inventory_gl_fk` FOREIGN KEY (`inventory_gl_id`) REFERENCES `gl_account_master` (`gl_account_id`) ON DELETE RESTRICT,
  CONSTRAINT `gl_pg_cogs_gl_fk` FOREIGN KEY (`cogs_gl_id`) REFERENCES `gl_account_master` (`gl_account_id`) ON DELETE RESTRICT
);
--> statement-breakpoint
ALTER TABLE `item_master` ADD `posting_group_id` varchar(36) DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `item_master` ADD CONSTRAINT `item_master_posting_group_fk` FOREIGN KEY (`posting_group_id`) REFERENCES `gl_posting_group` (`posting_group_id`) ON DELETE RESTRICT;
--> statement-breakpoint
-- Data step 1: one BIOLOGICAL group for each distinct set of animal accounts the items carry today (items with an acquisition account).
INSERT INTO `gl_posting_group` (posting_group_id, tenant_id, company_id, group_code, group_name, kind, asset_gl_id, accum_amort_gl_id, amort_expense_gl_id, fv_gain_gl_id, fv_loss_gl_id, writeoff_gl_id)
SELECT UUID(), t.tenant_id, t.company_id, CONCAT('BIO-', LPAD(t.rn, 3, '0')), CONCAT('Biological accounts ', t.rn), 'BIOLOGICAL',
       t.a, t.b, t.c, t.d, t.e, t.f
FROM (
  SELECT tenant_id, company_id, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY MIN(created_at), MIN(item_id)) AS rn,
         bio_acquisition_gl_id AS a, bio_accum_amort_gl_id AS b, bio_amort_expense_gl_id AS c, bio_fv_gain_loss_gl_id AS d, bio_fv_loss_gl_id AS e, bio_writeoff_gl_id AS f
  FROM `item_master`
  WHERE deleted_at IS NULL AND is_biological_asset = 1 AND bio_acquisition_gl_id IS NOT NULL AND company_id IS NOT NULL
  GROUP BY tenant_id, company_id, bio_acquisition_gl_id, bio_accum_amort_gl_id, bio_amort_expense_gl_id, bio_fv_gain_loss_gl_id, bio_fv_loss_gl_id, bio_writeoff_gl_id
) t;
--> statement-breakpoint
UPDATE `item_master` i JOIN `gl_posting_group` g
  ON g.company_id = i.company_id AND g.kind = 'BIOLOGICAL'
 AND g.asset_gl_id <=> i.bio_acquisition_gl_id AND g.accum_amort_gl_id <=> i.bio_accum_amort_gl_id AND g.amort_expense_gl_id <=> i.bio_amort_expense_gl_id
 AND g.fv_gain_gl_id <=> i.bio_fv_gain_loss_gl_id AND g.fv_loss_gl_id <=> i.bio_fv_loss_gl_id AND g.writeoff_gl_id <=> i.bio_writeoff_gl_id
SET i.posting_group_id = g.posting_group_id
WHERE i.deleted_at IS NULL AND i.is_biological_asset = 1 AND i.bio_acquisition_gl_id IS NOT NULL;
--> statement-breakpoint
-- Data step 2: one INVENTORY group for each distinct pair of stock / cost-of-sales accounts on a stock item.
INSERT INTO `gl_posting_group` (posting_group_id, tenant_id, company_id, group_code, group_name, kind, inventory_gl_id, cogs_gl_id)
SELECT UUID(), t.tenant_id, t.company_id, CONCAT('INV-', LPAD(t.rn, 3, '0')), CONCAT('Inventory accounts ', t.rn), 'INVENTORY', t.a, t.b
FROM (
  SELECT tenant_id, company_id, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY MIN(created_at), MIN(item_id)) AS rn,
         inventory_gl_account AS a, cogs_gl_account AS b
  FROM `item_master`
  WHERE deleted_at IS NULL AND (is_biological_asset IS NULL OR is_biological_asset = 0) AND company_id IS NOT NULL
    AND (inventory_gl_account IS NOT NULL OR cogs_gl_account IS NOT NULL)
  GROUP BY tenant_id, company_id, inventory_gl_account, cogs_gl_account
) t;
--> statement-breakpoint
UPDATE `item_master` i JOIN `gl_posting_group` g
  ON g.company_id = i.company_id AND g.kind = 'INVENTORY' AND g.inventory_gl_id <=> i.inventory_gl_account AND g.cogs_gl_id <=> i.cogs_gl_account
SET i.posting_group_id = g.posting_group_id
WHERE i.deleted_at IS NULL AND (i.is_biological_asset IS NULL OR i.is_biological_asset = 0) AND (i.inventory_gl_account IS NOT NULL OR i.cogs_gl_account IS NOT NULL);
--> statement-breakpoint
-- A group that serves one item is named after it (the others keep the numbered name until someone renames them).
UPDATE `gl_posting_group` g JOIN (SELECT posting_group_id, MIN(item_name) AS nm, COUNT(*) AS c FROM `item_master` WHERE deleted_at IS NULL AND posting_group_id IS NOT NULL GROUP BY posting_group_id) x
  ON x.posting_group_id = g.posting_group_id
SET g.group_name = x.nm
WHERE x.c = 1 AND (g.group_name LIKE 'Biological accounts %' OR g.group_name LIKE 'Inventory accounts %');
