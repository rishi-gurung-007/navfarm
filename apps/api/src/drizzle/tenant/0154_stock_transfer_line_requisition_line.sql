-- Part E (2026-10-04): a Store requisition's release creates one stock transfer whose lines
-- each name the requisition line they fulfil, so shipments and receipts can be written back
-- to requisition_line.qty_shipped / qty_received (1 Oct plan Task 8 quantities; 3 Oct spec
-- Part B "TO lines carry requisition line"). Additive and nullable: existing transfers keep NULL.
-- 0146 is reserved for the deferred feed-era drop and MUST be journalled with a `when` greater
-- than this file's (drizzle applies by `when`, not idx).
ALTER TABLE `stock_transfer_line` ADD `requisition_line_id` varchar(36);--> statement-breakpoint
ALTER TABLE `stock_transfer_line` ADD CONSTRAINT `stock_transfer_line_requisition_line_fk` FOREIGN KEY (`requisition_line_id`) REFERENCES `requisition_line`(`line_id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_stock_transfer_line_requisition_line` ON `stock_transfer_line` (`requisition_line_id`);
