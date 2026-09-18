SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'item_master'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    AND CONSTRAINT_NAME = 'item_master_tracking_series_id_no_series_master_series_id_fk'
);--> statement-breakpoint
SET @ddl := IF(@fk_exists > 0,
  'ALTER TABLE `item_master` DROP FOREIGN KEY `item_master_tracking_series_id_no_series_master_series_id_fk`',
  'SELECT 1'
);--> statement-breakpoint
PREPARE drop_fk FROM @ddl;--> statement-breakpoint
EXECUTE drop_fk;--> statement-breakpoint
DEALLOCATE PREPARE drop_fk;
