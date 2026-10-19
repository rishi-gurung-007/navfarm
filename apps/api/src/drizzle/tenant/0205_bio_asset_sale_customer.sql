-- 19 Oct 2026: a SOLD exit names its customer, so the sale's receivable has someone to belong to. Additive.
ALTER TABLE `bio_asset_ledger` ADD `customer_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `bio_asset_ledger` ADD CONSTRAINT `fk_bio_asset_ledger_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer_master`(`customer_id`) ON DELETE restrict ON UPDATE no action;
