ALTER TABLE `breed_master` DROP INDEX `uq_breed_master_scope_code`;--> statement-breakpoint
ALTER TABLE `breed_master` ADD CONSTRAINT `uq_breed_master_scope_code` UNIQUE(`tenant_id`,(coalesce(`company_id`, '')),(coalesce(`location_id`, '')),`breed_code`);
