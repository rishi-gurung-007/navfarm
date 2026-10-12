-- Semen quality on the collection (audit G8): volume, motility and concentration, read when the lot is judged fit to
-- use. A SEMEN_MOTILITY KPI already exists for data entry; these hold the reading on the lot itself, and the lot's QR
-- carries them. Additive and nullable: a collection recorded before this has none.
ALTER TABLE `semen_batch` ADD COLUMN `volume_ml` decimal(10,2) NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD COLUMN `motility_pct` decimal(5,2) NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `semen_batch` ADD COLUMN `concentration_m_per_ml` decimal(10,2) NULL DEFAULT NULL;
