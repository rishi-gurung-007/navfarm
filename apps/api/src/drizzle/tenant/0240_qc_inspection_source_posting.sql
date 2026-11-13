-- 3 Nov 2026 (plan 2026-11-03-incoming-qc): a QC inspection can now be raised by a semen collection as well as a goods receipt, and the ledger entry it writes when accepted
-- needs the G/L mapping and the batch number the collection would have posted under. Additive: two nullable columns on qc_inspection; nothing is updated.
ALTER TABLE `qc_inspection` ADD `gl_mapping_type` varchar(40);
--> statement-breakpoint
ALTER TABLE `qc_inspection` ADD `batch_no` varchar(50);
