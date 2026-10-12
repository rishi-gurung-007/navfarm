ALTER TABLE `transfer_receipt_line` ADD `variance_qty` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `transfer_receipt_line` ADD `variance_reason` varchar(500);
--> statement-breakpoint
ALTER TABLE `transfer_receipt_line` ADD `bag_count` int;
--> statement-breakpoint
ALTER TABLE `transfer_receipt_line` ADD `delivery_note_no` varchar(80);
--> statement-breakpoint
ALTER TABLE `transfer_receipt_line` ADD `loading_sheet_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `transfer_receipt_line` ADD `loading_sheet_no` varchar(80);
