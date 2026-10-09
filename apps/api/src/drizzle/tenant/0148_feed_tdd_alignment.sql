-- Feed TDD alignment (spec 2026-10-03 §3.2): safety stock, bag size, diet no, feed form, mill/TO links on requisition.
ALTER TABLE `feed_planning_setting` ADD `safety_stock_kg` decimal(14,2);--> statement-breakpoint
ALTER TABLE `feed_planning_setting` ADD `bag_size_kg` decimal(14,2);--> statement-breakpoint
ALTER TABLE `item_master` ADD `diet_no` int;--> statement-breakpoint
ALTER TABLE `breed_lifecycle_stages` ADD `feed_form` varchar(10);--> statement-breakpoint
ALTER TABLE `requisition` ADD `linked_transfer_id` varchar(36);--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `mill_approved_qty_kg` decimal(18,4);--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `recommended_delivery_date` date;--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `exceeds_silo_capacity` boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE `requisition` ADD CONSTRAINT `requisition_linked_transfer_fk` FOREIGN KEY (`linked_transfer_id`) REFERENCES `stock_transfer`(`transfer_id`) ON DELETE set null ON UPDATE no action;
