-- goods_issue_line and stock_transfer_line never carried lot_no/serial_no,
-- so a lot- or serial-tracked item's consumption/transfer could never write
-- that identity onto inventory_ledger even though goods_receipt_line and
-- inventory_ledger itself already had the columns. See docs/decisions.md.
ALTER TABLE `goods_issue_line` ADD `lot_no` varchar(50);
--> statement-breakpoint
ALTER TABLE `goods_issue_line` ADD `serial_no` varchar(100);
--> statement-breakpoint
ALTER TABLE `stock_transfer_line` ADD `lot_no` varchar(50);
--> statement-breakpoint
ALTER TABLE `stock_transfer_line` ADD `serial_no` varchar(100);
