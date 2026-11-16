-- 20 Oct 2026 (bio-asset costing, Phase 3): the profile an animal is costed by, frozen at first resolution, and the date its
-- costing begins. Additive and nullable: an animal with no matching profile simply has neither.
ALTER TABLE `animal_register` ADD `costing_profile_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `animal_register` ADD `costing_start_date` date;
--> statement-breakpoint
ALTER TABLE `animal_register` ADD CONSTRAINT `fk_animal_costing_profile` FOREIGN KEY (`costing_profile_id`) REFERENCES `bio_costing_profile`(`profile_id`) ON DELETE restrict ON UPDATE no action;
