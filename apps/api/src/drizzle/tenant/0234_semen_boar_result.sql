-- 2 Nov 2026 (AI Station, plan 2026-11-02-ai-station-semen-collection, Phase 2): what each boar gave at a collection. The boar sheets read each boar's last
-- raw semen (ml), doses and morphology, but a pooled lot only carries totals and a single-boar lot's figures sit on the lot, so there was nothing per boar to
-- read them from. One row per boar per lot; a rejected ejaculate is recorded here and is in none of the lot's doses, boars or costs. Additive: one new table,
-- nothing updated. A lot recorded before this has no rows and reads as "no figure", never zero.
CREATE TABLE `semen_boar_result` (
	`semen_batch_id` varchar(36) NOT NULL,
	`boar_animal_id` varchar(36) NOT NULL,
	`tenant_id` varchar(36) NOT NULL,
	`collector_id` varchar(36),
	`volume_ml` decimal(10,2),
	`doses` int,
	`morphology_pct` decimal(5,2),
	`motility_pct` decimal(5,2),
	`concentration_m_per_ml` decimal(10,2),
	`accepted` boolean NOT NULL DEFAULT true,
	`reject_reason` varchar(200),
	`sort_order` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `semen_boar_result_semen_batch_id_boar_animal_id` PRIMARY KEY(`semen_batch_id`,`boar_animal_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_semen_boar_result_boar` ON `semen_boar_result` (`boar_animal_id`);
--> statement-breakpoint
ALTER TABLE `semen_boar_result` ADD CONSTRAINT `semen_boar_result_semen_batch_id_semen_batch_semen_batch_id_fk` FOREIGN KEY (`semen_batch_id`) REFERENCES `semen_batch`(`semen_batch_id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `semen_boar_result` ADD CONSTRAINT `semen_boar_result_boar_animal_id_animal_register_animal_id_fk` FOREIGN KEY (`boar_animal_id`) REFERENCES `animal_register`(`animal_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `semen_boar_result` ADD CONSTRAINT `semen_boar_result_collector_id_semen_collector_collector_id_fk` FOREIGN KEY (`collector_id`) REFERENCES `semen_collector`(`collector_id`) ON DELETE set null ON UPDATE no action;
