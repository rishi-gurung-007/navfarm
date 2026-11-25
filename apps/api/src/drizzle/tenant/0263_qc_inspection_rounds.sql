-- 24 Nov 2026 (plan 2026-11-24-semen-supply-chain-master-plan, Phase 1): an item's QC can be done in several dated rounds (the client's semen QC: collection day + 4 days).
-- `item_master.qc_rounds` is how many (default 1: every existing item and inspection behaves as before). An inspection raised with more than one round gets one set of check
-- lines per round (`qc_inspection_line.round_no`) and one `qc_inspection_round` row per round, due on the source's posting date + round_no days. Additive; nothing updated.
ALTER TABLE `item_master` ADD `qc_rounds` int NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `qc_inspection` ADD `rounds` int NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `qc_inspection_line` ADD `round_no` int NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE `qc_inspection_round` (`round_id` varchar(36) NOT NULL, `inspection_id` varchar(36) NOT NULL, `round_no` int NOT NULL, `due_date` date NOT NULL, `status` varchar(12) NOT NULL DEFAULT 'PENDING', `result` varchar(10), `inspected_by` varchar(36), `inspected_at` timestamp NULL, `remarks` varchar(500), `created_at` timestamp NOT NULL DEFAULT (now()), CONSTRAINT `qc_inspection_round_round_id` PRIMARY KEY(`round_id`));
--> statement-breakpoint
ALTER TABLE `qc_inspection_round` ADD CONSTRAINT `qc_inspection_round_inspection_fk` FOREIGN KEY (`inspection_id`) REFERENCES `qc_inspection`(`inspection_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_qc_inspection_round_no` ON `qc_inspection_round` (`inspection_id`,`round_no`);
