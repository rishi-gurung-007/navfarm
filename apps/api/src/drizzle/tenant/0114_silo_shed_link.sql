-- Silo <-> shed becomes many-to-many (Rishi, 2026-09-25; spec D7). A shed may
-- now draw from several silos — one per feed item (D9) — so the single
-- feed_silo_id column on the shed can no longer say it. The rows are copied
-- across here; the column is dropped in 0115 once nothing reads it.
CREATE TABLE `silo_shed_link` (
  `link_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `silo_id` varchar(36) NOT NULL,
  `shed_id` varchar(36) NOT NULL,
  `created_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `silo_shed_link_link_id` PRIMARY KEY(`link_id`),
  CONSTRAINT `uq_silo_shed_link` UNIQUE(`silo_id`,`shed_id`)
);
--> statement-breakpoint
ALTER TABLE `silo_shed_link` ADD CONSTRAINT `silo_shed_link_silo_fk` FOREIGN KEY (`silo_id`) REFERENCES `location_master`(`location_id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `silo_shed_link` ADD CONSTRAINT `silo_shed_link_shed_fk` FOREIGN KEY (`shed_id`) REFERENCES `location_master`(`location_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_silo_shed_link_shed` ON `silo_shed_link` (`shed_id`);
--> statement-breakpoint
INSERT INTO `silo_shed_link` (`link_id`, `tenant_id`, `company_id`, `silo_id`, `shed_id`)
SELECT UUID(), s.`tenant_id`, s.`company_id`, s.`feed_silo_id`, s.`location_id`
FROM `location_master` s WHERE s.`feed_silo_id` IS NOT NULL;
--> statement-breakpoint
-- Spec D3: Date to Refill = run-down - buffer days; Required On = refill - lead
-- time. Per farm because delivery distance is per farm. Read only on FARM rows.
ALTER TABLE `location_master` ADD `feed_refill_buffer_days` int DEFAULT 2;
--> statement-breakpoint
ALTER TABLE `location_master` ADD `feed_lead_time_days` int DEFAULT 0;
