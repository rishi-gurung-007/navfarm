ALTER TABLE `no_series`
  ADD COLUMN `master_type` varchar(50) NULL AFTER `description`,
  ADD COLUMN `seq_length` int NOT NULL DEFAULT 4 AFTER `no_series_code`,
  ADD COLUMN `is_default` tinyint(1) NOT NULL DEFAULT 1 AFTER `increment_by`,
  ADD INDEX `idx_no_series_master_type` (`tenant_id`, `master_type`);

-- Seed master_type for existing records
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'ITEM' WHERE `code` IN ('NS-FEED', 'NS-MED', 'NS-RAW', 'NS-consumption', 'ITEM');
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'SUPPLIER' WHERE `code` = 'SUPPLIER';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'CUSTOMER' WHERE `code` = 'CUSTOMER';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'LOCATION' WHERE `code` = 'LOCATION';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'LOCATION_TYPE' WHERE `code` = 'LOCATION_TYPE';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'ANIMAL' WHERE `code` = 'ANIMAL';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'BREED' WHERE `code` = 'BREED';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'SPECIES' WHERE `code` = 'SPECIES';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'UOM' WHERE `code` = 'UOM';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'UOM_CONVERSION' WHERE `code` = 'UOM_CONVERSION';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'STAGE' WHERE `code` = 'STAGE';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'ITEM_CATEGORY' WHERE `code` = 'ITEM_CATEGORY';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'ITEM_TYPE' WHERE `code` = 'ITEM_TYPE';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'ITEM_ATTRIBUTE' WHERE `code` = 'ITEM_ATTRIBUTE';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'FEED_FORMULA' WHERE `code` = 'FEED_FORMULA';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'DISEASE' WHERE `code` = 'DISEASE';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'REASON' WHERE `code` = 'REASON';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'RESOURCE' WHERE `code` = 'RESOURCE';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'GL_ACCOUNT' WHERE `code` = 'GL_ACCOUNT';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'GL_MAPPING' WHERE `code` = 'GL_MAPPING';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'COST_CENTER' WHERE `code` = 'COST_CENTER';
--> statement-breakpoint
UPDATE `no_series` SET `master_type` = 'BREED_LIFECYCLE_STAGE' WHERE `code` = 'BREED_LIFECYCLE_STAGE';
