-- Expand serial_no and remarks to TEXT to prevent truncation errors
-- when multiple serial numbers (e.g. 10-58+ serials) are assigned to an item line.
ALTER TABLE `stock_transfer_line` MODIFY COLUMN `serial_no` text;
--> statement-breakpoint
ALTER TABLE `stock_transfer_line` MODIFY COLUMN `remarks` text;
--> statement-breakpoint
ALTER TABLE `inventory_ledger` MODIFY COLUMN `serial_no` text;
--> statement-breakpoint
ALTER TABLE `goods_issue_line` MODIFY COLUMN `serial_no` text;
--> statement-breakpoint
ALTER TABLE `goods_receipt_line` MODIFY COLUMN `serial_no` text;
--> statement-breakpoint
ALTER TABLE `stock_adjustment_line` MODIFY COLUMN `serial_no` text;
