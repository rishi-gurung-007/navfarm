ALTER TABLE `no_series`
  ADD COLUMN `master_type` varchar(50) NULL AFTER `description`,
  ADD COLUMN `seq_length` int NOT NULL DEFAULT 4 AFTER `no_series_code`,
  ADD COLUMN `is_default` tinyint(1) NOT NULL DEFAULT 1 AFTER `increment_by`,
  ADD INDEX `idx_no_series_master_type` (`tenant_id`, `master_type`);

-- Seed master_type for existing records
UPDATE `no_series` SET `master_type` = 'ITEM' WHERE `code` IN ('NS-FEED', 'NS-MED', 'NS-RAW', 'NS-consumption', 'ITEM');
UPDATE `no_series` SET `master_type` = 'SUPPLIER' WHERE `code` = 'SUPPLIER';
UPDATE `no_series` SET `master_type` = 'CUSTOMER' WHERE `code` = 'CUSTOMER';
UPDATE `no_series` SET `master_type` = 'LOCATION' WHERE `code` = 'LOCATION';
UPDATE `no_series` SET `master_type` = 'LOCATION_TYPE' WHERE `code` = 'LOCATION_TYPE';
UPDATE `no_series` SET `master_type` = 'ANIMAL' WHERE `code` = 'ANIMAL';
UPDATE `no_series` SET `master_type` = 'BREED' WHERE `code` = 'BREED';
UPDATE `no_series` SET `master_type` = 'SPECIES' WHERE `code` = 'SPECIES';
UPDATE `no_series` SET `master_type` = 'UOM' WHERE `code` = 'UOM';
UPDATE `no_series` SET `master_type` = 'UOM_CONVERSION' WHERE `code` = 'UOM_CONVERSION';
UPDATE `no_series` SET `master_type` = 'STAGE' WHERE `code` = 'STAGE';
UPDATE `no_series` SET `master_type` = 'ITEM_CATEGORY' WHERE `code` = 'ITEM_CATEGORY';
UPDATE `no_series` SET `master_type` = 'ITEM_TYPE' WHERE `code` = 'ITEM_TYPE';
UPDATE `no_series` SET `master_type` = 'ITEM_ATTRIBUTE' WHERE `code` = 'ITEM_ATTRIBUTE';
UPDATE `no_series` SET `master_type` = 'FEED_FORMULA' WHERE `code` = 'FEED_FORMULA';
UPDATE `no_series` SET `master_type` = 'DISEASE' WHERE `code` = 'DISEASE';
UPDATE `no_series` SET `master_type` = 'REASON' WHERE `code` = 'REASON';
UPDATE `no_series` SET `master_type` = 'RESOURCE' WHERE `code` = 'RESOURCE';
UPDATE `no_series` SET `master_type` = 'GL_ACCOUNT' WHERE `code` = 'GL_ACCOUNT';
UPDATE `no_series` SET `master_type` = 'GL_MAPPING' WHERE `code` = 'GL_MAPPING';
UPDATE `no_series` SET `master_type` = 'COST_CENTER' WHERE `code` = 'COST_CENTER';
UPDATE `no_series` SET `master_type` = 'BREED_LIFECYCLE_STAGE' WHERE `code` = 'BREED_LIFECYCLE_STAGE';
