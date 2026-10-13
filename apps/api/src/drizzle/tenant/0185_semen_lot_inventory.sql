-- A semen collection posted to inventory is a lot of whatever item the farm chose for semen, held in the boar's farm
-- store, with a lot-level QR. These columns tie the semen lot to its stock and its QR. Additive and nullable: a lot
-- collected before this has none of them and keeps inventory_posted = 0.
ALTER TABLE `semen_batch` ADD COLUMN `lot_no` varchar(50) NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD COLUMN `expiry_date` date NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD COLUMN `warehouse_id` varchar(36) NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD COLUMN `qr_id` varchar(36) NULL DEFAULT NULL;
