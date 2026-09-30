-- Silo -> shed feed link and silo capacity unit (docs/decisions.md, 2026-09-24).
--
-- feed_silo_id lives on the SHED row rather than in a join table: the client's
-- rule is that one silo may serve many sheds but a shed draws from exactly one
-- silo, so a self-FK makes one-silo-per-shed structurally impossible to
-- violate. The "Attached Sheds" multi-select on the silo form is a view of
-- this column across the parent farm's sheds, not a separate relation.
--
-- silo_capacity_kg keeps storing canonical KILOGRAMS. silo_capacity_uom records
-- the unit the number was entered in (KG or TON) so the form can show it back
-- unchanged; the service multiplies by 1000 on the way in when it is TON.
-- Renaming silo_capacity_kg was rejected: ten live references across
-- location.service.ts, the two DTOs, three seed scripts and the web config,
-- for a cosmetic gain — and every stock comparison is in KG regardless.
ALTER TABLE `location_master` ADD `feed_silo_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `location_master` ADD `silo_capacity_uom` varchar(10);
--> statement-breakpoint
ALTER TABLE `location_master` ADD CONSTRAINT `location_master_feed_silo_id_fk` FOREIGN KEY (`feed_silo_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX `idx_location_master_feed_silo_id` ON `location_master` (`feed_silo_id`);
