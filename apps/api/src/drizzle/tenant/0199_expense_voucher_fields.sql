-- 15 Oct 2026 (Arun): the manager's voucher entry format for expense documents — Voucher Type, Balance Account Type, Location
-- (the farm), Sub-Location (the shed) and Remarks. Additive: new columns on the table 0198 created.
ALTER TABLE `expense_document` ADD `voucher_type` varchar(10) NOT NULL DEFAULT 'GL';
--> statement-breakpoint
ALTER TABLE `expense_document` ADD `balance_account_type` varchar(10) NOT NULL DEFAULT 'GL';
--> statement-breakpoint
ALTER TABLE `expense_document` ADD `location_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `expense_document` ADD `sub_location_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `expense_document` ADD `remarks` text;
--> statement-breakpoint
ALTER TABLE `expense_document` ADD CONSTRAINT `fk_expense_doc_location` FOREIGN KEY (`location_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `expense_document` ADD CONSTRAINT `fk_expense_doc_sub_location` FOREIGN KEY (`sub_location_id`) REFERENCES `location_master`(`location_id`) ON DELETE restrict ON UPDATE no action;
