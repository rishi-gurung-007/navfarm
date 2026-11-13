-- 9 Nov 2026 (client: the item card's QC Specification adds checks from the QC Parameter Master, it does not type them in): a specification line names
-- the QC parameter it was taken from, and carries the parameter's Target Value; an inspection line copies the target with the rest. Additive: two
-- nullable columns on item_qc_spec_line, one on qc_inspection_line, one foreign key; nothing updated.
ALTER TABLE `item_qc_spec_line` ADD `param_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `item_qc_spec_line` ADD `target_value` decimal(18,4);
--> statement-breakpoint
ALTER TABLE `item_qc_spec_line` ADD CONSTRAINT `fk_iqsl_qc_param` FOREIGN KEY (`param_id`) REFERENCES `qc_parameter_master`(`param_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `qc_inspection_line` ADD `target_value` decimal(18,4);
