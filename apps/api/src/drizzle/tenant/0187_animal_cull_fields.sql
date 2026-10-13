-- Culling (BBP-1): "On mortality or cull: record CLOSED (not deleted). Closure date, reason, disposal destination,
-- weight at death/cull recorded", and "Out-of-Production Date and Cull Date are TWO SEPARATE fields (MOM 24 Aug).
-- System does not allow Cull Date < Out-of-Production Date". The register had expected_cull_date only. These hold
-- the two dates, the weight at exit and where the animal went. Additive and nullable: every existing row keeps NULL.
ALTER TABLE `animal_register` ADD COLUMN `out_of_production_date` date NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `animal_register` ADD COLUMN `cull_date` date NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `animal_register` ADD COLUMN `exit_weight_kg` decimal(10,3) NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `animal_register` ADD COLUMN `disposal_destination` varchar(100) NULL DEFAULT NULL;
