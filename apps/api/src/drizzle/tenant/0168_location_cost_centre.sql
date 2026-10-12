-- Each farm has its own cost centre (decisions, 11 Oct; workbook "Silo Balance
-- and Stock Take" row 47). A FARM or MILL location names the Cost Center Master
-- row its inventory journal lines are posted against. Nullable and additive;
-- department_id is a different identity (DEPARTMENT type) and is untouched.
ALTER TABLE `location_master` ADD `cost_center_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `location_master` ADD CONSTRAINT `location_master_cost_center_fk` FOREIGN KEY (`cost_center_id`) REFERENCES `cost_center_master`(`cost_center_id`) ON DELETE set null ON UPDATE no action;
