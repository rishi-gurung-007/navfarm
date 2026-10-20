-- 19 Oct 2026 (Arun): fostering links two litters. Piglets moved from one sow's litter to another's are one record here:
-- the donor litter, the receiving litter, how many and when. The piglet lots' head moves by an ordinary batch transfer and
-- both farrowing records' fostered_out / foster_received follow. Additive: a new table, nothing existing is touched.
CREATE TABLE `litter_foster` (
  `foster_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `from_farrow_id` varchar(36) NOT NULL,
  `to_farrow_id` varchar(36) NOT NULL,
  `quantity` int NOT NULL,
  `foster_date` date NOT NULL,
  `transfer_no` varchar(50),
  `notes` text,
  `created_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `litter_foster_foster_id` PRIMARY KEY(`foster_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_litter_foster_from` ON `litter_foster` (`from_farrow_id`);
--> statement-breakpoint
CREATE INDEX `idx_litter_foster_to` ON `litter_foster` (`to_farrow_id`);
--> statement-breakpoint
ALTER TABLE `litter_foster` ADD CONSTRAINT `fk_litter_foster_company` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `litter_foster` ADD CONSTRAINT `fk_litter_foster_from` FOREIGN KEY (`from_farrow_id`) REFERENCES `farrowing_record`(`farrow_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `litter_foster` ADD CONSTRAINT `fk_litter_foster_to` FOREIGN KEY (`to_farrow_id`) REFERENCES `farrowing_record`(`farrow_id`) ON DELETE restrict ON UPDATE no action;
