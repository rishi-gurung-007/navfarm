ALTER TABLE `item_attribute_master` MODIFY `data_type` varchar(20) NOT NULL DEFAULT 'NUMBER';
--> statement-breakpoint
ALTER TABLE `item_attribute_master` ADD `uom_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `item_attribute_master` ADD CONSTRAINT `item_attribute_master_uom_id_fk` FOREIGN KEY (`uom_id`) REFERENCES `uom_master`(`uom_id`) ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE `item_attribute_master` ADD `default_value` decimal(18,4);
--> statement-breakpoint
CREATE INDEX `idx_item_attribute_master_uom_id` ON `item_attribute_master` (`uom_id`);
