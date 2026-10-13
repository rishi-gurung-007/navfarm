-- A posted day that is reopened for correction has its postings reversed (stock, journals, carrying value), so the
-- corrected entry can be posted without counting the first one twice. The batch transaction rows are not deleted —
-- they stay as the record of what was posted — but are marked reversed, and every reader of batch cost and activity
-- skips a reversed row. Additive and nullable: every existing row is simply "not reversed".
ALTER TABLE `batch_transaction` ADD COLUMN `reversed_at` timestamp NULL DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `batch_transaction` ADD COLUMN `reversed_by` varchar(36) NULL DEFAULT NULL;
