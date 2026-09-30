ALTER TABLE `item_master` ADD CONSTRAINT `item_master_tracking_series_id_no_series_id_fk` FOREIGN KEY (`tracking_series_id`) REFERENCES `no_series`(`id`) ON DELETE SET NULL;
