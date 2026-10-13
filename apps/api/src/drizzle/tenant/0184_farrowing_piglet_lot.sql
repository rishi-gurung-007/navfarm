-- A farrowing now creates its piglets as a lot of the piglet bio-asset item in a batch-wise batch (decision of 9 Oct,
-- awaiting Rishi). The farrowing record points at that batch and carries the lot number, so the sow's card, the batch
-- and weaning can find each other. Additive and nullable: every earlier farrowing simply has no piglet lot.
ALTER TABLE `farrowing_record` ADD COLUMN `piglet_batch_id` varchar(36) NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `farrowing_record` ADD COLUMN `piglet_lot_no` varchar(50) NULL DEFAULT NULL;
