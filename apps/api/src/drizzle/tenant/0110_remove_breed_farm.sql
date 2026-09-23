-- Farm is no longer part of a Breed profile's identity: the whole reason
-- breed_code was scoped unique per (tenant, company, farm) rather than per
-- (tenant, company) was to let the same breed name/code recur once per farm
-- (docs/decisions.md, Rishi, 2026-09-14). With farm removed there is no axis
-- left to distinguish those rows by code, and real seeded rows already share
-- a code across farms (TN-70-Sow x7, TEASER_BOAR x6, etc.) — re-adding
-- uniqueness at (tenant, company) would conflict with that existing, valid
-- data rather than the field this migration actually removes. breed_code is
-- left a plain, non-unique column; breed_id remains the real identity every
-- reference (animal, batch, transfer) already uses.
ALTER TABLE `breed_master` DROP FOREIGN KEY `breed_master_location_id_location_master_location_id_fk`;--> statement-breakpoint
ALTER TABLE `breed_master` DROP INDEX `uq_breed_master_scope_code`;--> statement-breakpoint
ALTER TABLE `breed_master` DROP COLUMN `location_id`;
