ALTER TABLE `approval_request` ADD COLUMN `reference_id` varchar(36) NULL;--> statement-breakpoint
CREATE INDEX `approval_request_reference_id_idx` ON `approval_request` (`reference_id`);
