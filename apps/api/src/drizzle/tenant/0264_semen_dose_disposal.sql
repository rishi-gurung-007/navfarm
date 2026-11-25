-- 24 Nov 2026 (plan 2026-11-24-semen-supply-chain-master-plan, Phase 3): destroyed semen doses. The client's AI Station report reads
-- "Requested 100, Received 90, Used 70, Destroyed 20"; nothing recorded a destroyed dose before. One row per destruction: doses written off
-- from a store's stock (a VARIANCE_NEGATIVE ledger entry, with its journal) or doses a QC inspection rejected and scrapped (never stock, no
-- entry). `semen_batch.doses_destroyed` counts the written-off ones, so a lot's doses left = collected - used - sold - destroyed. Additive.
ALTER TABLE `semen_batch` ADD `doses_destroyed` decimal(10,2) NOT NULL DEFAULT '0';
--> statement-breakpoint
CREATE TABLE `semen_dose_disposal` (`disposal_id` varchar(36) NOT NULL, `tenant_id` varchar(36) NOT NULL, `company_id` varchar(36) NOT NULL, `disposal_no` varchar(30) NOT NULL, `semen_batch_id` varchar(36) NOT NULL, `lot_no` varchar(50), `item_id` varchar(36), `warehouse_id` varchar(36), `farm_id` varchar(36), `doses` decimal(10,2) NOT NULL, `disposal_date` date NOT NULL, `reason_type` varchar(20) NOT NULL, `reason_id` varchar(36), `source` varchar(20) NOT NULL DEFAULT 'MANUAL', `qc_inspection_id` varchar(36), `ledger_entry_id` varchar(36), `amount` decimal(18,4), `remarks` varchar(500), `created_by` varchar(36), `created_at` timestamp NOT NULL DEFAULT (now()), CONSTRAINT `semen_dose_disposal_disposal_id` PRIMARY KEY(`disposal_id`));
--> statement-breakpoint
ALTER TABLE `semen_dose_disposal` ADD CONSTRAINT `semen_dose_disposal_batch_fk` FOREIGN KEY (`semen_batch_id`) REFERENCES `semen_batch`(`semen_batch_id`) ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_semen_dose_disposal_no` ON `semen_dose_disposal` (`tenant_id`,`company_id`,`disposal_no`);
--> statement-breakpoint
CREATE INDEX `idx_semen_dose_disposal_lot` ON `semen_dose_disposal` (`semen_batch_id`);
--> statement-breakpoint
CREATE INDEX `idx_semen_dose_disposal_farm_date` ON `semen_dose_disposal` (`tenant_id`,`farm_id`,`disposal_date`);
