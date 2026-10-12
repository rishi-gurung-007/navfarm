-- What the user chose on a data-entry line, kept on the draft so posting the day uses it: the item an OUTPUT entry
-- takes out of the batch (any item, chosen at entry; the line's own item is only the default), and the batch a
-- TRANSFER entry — or a weaning entered as output — sends head to. Before this a draft kept neither, so a TRANSFER
-- saved as a draft lost its destination when the day was posted. Additive and nullable: existing rows keep the line's
-- item and have no destination, exactly as they were read before.
ALTER TABLE `batch_daily_data` ADD COLUMN `item_id` varchar(36) NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `batch_daily_data` ADD COLUMN `destination_batch_id` varchar(36) NULL DEFAULT NULL;
