-- Inventory Ledger "Entry No.": a readable whole number (1, 2, 3 ...) per tenant, in
-- place of the ledger UUID, which is only the internal key. The number is handed out
-- from a counter row inside the inserting transaction, so a posting that rolls back
-- (for example "Insufficient stock") gives its number back and the series has no gaps.
-- A trigger assigns it, so every writer - the posting service, the batch daily-entry
-- inserts and the seed scripts - is numbered the same way. Existing rows are numbered
-- by posting date, then creation time; within a tie an inbound comes before an outbound.
CREATE TABLE IF NOT EXISTS `inventory_entry_counter` (
  `tenant_id` varchar(36) NOT NULL,
  `last_entry_no` bigint unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`tenant_id`)
);
--> statement-breakpoint
ALTER TABLE `inventory_ledger` ADD COLUMN `entry_no` bigint unsigned NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `inventory_ledger` l
JOIN (
  SELECT `ledger_id`,
         ROW_NUMBER() OVER (PARTITION BY `tenant_id` ORDER BY `posting_date`, `created_at`, (`quantity` < 0), `ledger_id`) AS rn
  FROM `inventory_ledger`
) x ON x.`ledger_id` = l.`ledger_id`
SET l.`entry_no` = x.rn;
--> statement-breakpoint
ALTER TABLE `inventory_ledger` ADD UNIQUE INDEX `uq_inventory_ledger_entry_no` (`tenant_id`, `entry_no`);
--> statement-breakpoint
INSERT INTO `inventory_entry_counter` (`tenant_id`, `last_entry_no`)
SELECT `tenant_id`, MAX(`entry_no`) FROM `inventory_ledger` GROUP BY `tenant_id`
ON DUPLICATE KEY UPDATE `last_entry_no` = VALUES(`last_entry_no`);
--> statement-breakpoint
ALTER TABLE `inventory_application`
  ADD COLUMN `inbound_entry_no` bigint unsigned NOT NULL DEFAULT 0,
  ADD COLUMN `outbound_entry_no` bigint unsigned NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE `inventory_application` a
JOIN `inventory_ledger` i ON i.`ledger_id` = a.`inbound_ledger_id`
JOIN `inventory_ledger` o ON o.`ledger_id` = a.`outbound_ledger_id`
SET a.`inbound_entry_no` = i.`entry_no`, a.`outbound_entry_no` = o.`entry_no`;
--> statement-breakpoint
CREATE TRIGGER `trg_inventory_ledger_entry_no` BEFORE INSERT ON `inventory_ledger`
FOR EACH ROW
BEGIN
  DECLARE next_no bigint unsigned;
  IF NEW.`entry_no` IS NULL OR NEW.`entry_no` = 0 THEN
    INSERT INTO `inventory_entry_counter` (`tenant_id`, `last_entry_no`) VALUES (NEW.`tenant_id`, 1)
      ON DUPLICATE KEY UPDATE `last_entry_no` = `last_entry_no` + 1;
    SELECT `last_entry_no` INTO next_no FROM `inventory_entry_counter` WHERE `tenant_id` = NEW.`tenant_id`;
    SET NEW.`entry_no` = next_no;
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `trg_inventory_application_entry_no` BEFORE INSERT ON `inventory_application`
FOR EACH ROW
BEGIN
  IF NEW.`inbound_entry_no` IS NULL OR NEW.`inbound_entry_no` = 0 THEN
    SET NEW.`inbound_entry_no` = (SELECT `entry_no` FROM `inventory_ledger` WHERE `ledger_id` = NEW.`inbound_ledger_id`);
  END IF;
  IF NEW.`outbound_entry_no` IS NULL OR NEW.`outbound_entry_no` = 0 THEN
    SET NEW.`outbound_entry_no` = (SELECT `entry_no` FROM `inventory_ledger` WHERE `ledger_id` = NEW.`outbound_ledger_id`);
  END IF;
END;
