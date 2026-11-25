-- 24 Nov 2026 (plan 2026-11-24-semen-supply-chain-master-plan, Phase 4): semen requisition and consolidation. A farm asks the AI Station for
-- doses with an ordinary Store requisition (collection store -> its own store, the semen item, doses) that names the breeding line
-- (`requisition.breed_id`; NULL on every other requisition). The AI Station plans a collection from the open requests: the plan keeps its
-- target dose count and one link per request line it serves (`semen_plan_requisition`). Once the collected lot is clear of QC it is allocated
-- to the linked lines (the lot assigned through the requisition's own Item Tracking), and the requisition ships and receives as before. Additive.
ALTER TABLE `requisition` ADD `breed_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `semen_collection_plan` ADD `target_doses` decimal(10,2);
--> statement-breakpoint
CREATE TABLE `semen_plan_requisition` (`link_id` varchar(36) NOT NULL, `tenant_id` varchar(36) NOT NULL, `plan_id` varchar(36), `requisition_id` varchar(36) NOT NULL, `requisition_line_id` varchar(36) NOT NULL, `doses` decimal(10,2) NOT NULL, `semen_batch_id` varchar(36), `allocated_at` timestamp NULL, `created_at` timestamp NOT NULL DEFAULT (now()), CONSTRAINT `semen_plan_requisition_link_id` PRIMARY KEY(`link_id`));
--> statement-breakpoint
ALTER TABLE `semen_plan_requisition` ADD CONSTRAINT `semen_plan_requisition_plan_fk` FOREIGN KEY (`plan_id`) REFERENCES `semen_collection_plan`(`plan_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_semen_plan_requisition_line` ON `semen_plan_requisition` (`requisition_line_id`);
--> statement-breakpoint
CREATE INDEX `idx_semen_plan_requisition_plan` ON `semen_plan_requisition` (`plan_id`);
--> statement-breakpoint
CREATE INDEX `idx_requisition_breed` ON `requisition` (`breed_id`);
