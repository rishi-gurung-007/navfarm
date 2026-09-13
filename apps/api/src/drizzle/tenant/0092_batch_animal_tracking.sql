ALTER TABLE `batch_header` ADD `animal_tracking` varchar(20) DEFAULT 'COUNT_ONLY' NOT NULL;--> statement-breakpoint
UPDATE `batch_header` b SET b.`animal_tracking` = 'REGISTERED'
 WHERE EXISTS (SELECT 1 FROM `animal_register` a WHERE a.`current_batch_id` = b.`batch_id`);
