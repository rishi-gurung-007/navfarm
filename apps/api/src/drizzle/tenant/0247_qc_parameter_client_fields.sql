-- 9 Nov 2026 (client's QC Parameter Master field list): QC Code, Description, QC Type, Unit of Measurement, Min / Max / Target Value, Mandatory, Active.
-- Target Value is new. Line of Business is not on the client's list, so a parameter may now be left without one (it then applies to every line, which the
-- batch QC lookup already allows). QC Code is unique per company. Additive: one nullable column, one column made nullable, one unique index; nothing updated.
ALTER TABLE `qc_parameter_master` ADD `target_value` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `qc_parameter_master` MODIFY `lob_id` varchar(36);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_qc_parameter_company_code` ON `qc_parameter_master` (`tenant_id`,`company_id`,`param_code`);
