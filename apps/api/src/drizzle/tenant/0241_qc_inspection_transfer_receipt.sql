-- 3 Nov 2026 (plan 2026-11-03-incoming-qc): a stock transfer receipt of a QC-required item raises an inspection too. One transfer line can be received in several parts, so the
-- inspection is no longer unique per source line (the unique index becomes a plain one), and it carries what writing the receipt later needs: the amount the receipt takes out of
-- In Transit, the ledger entry type, the transfer it belongs to, and the source location a rejected quantity goes back to. Additive apart from that index; nothing is updated.
ALTER TABLE `qc_inspection` DROP INDEX `uq_qc_inspection_source_line`;
--> statement-breakpoint
CREATE INDEX `idx_qc_inspection_source` ON `qc_inspection` (`source_doc_type`,`source_doc_no`,`source_line_id`);
--> statement-breakpoint
ALTER TABLE `qc_inspection` ADD `amount` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `qc_inspection` ADD `entry_type` varchar(20);
--> statement-breakpoint
ALTER TABLE `qc_inspection` ADD `parent_doc_no` varchar(50);
--> statement-breakpoint
ALTER TABLE `qc_inspection` ADD `return_warehouse_id` varchar(36);
