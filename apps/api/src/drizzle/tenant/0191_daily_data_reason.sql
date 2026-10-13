-- The reason picked for a death entered on a MORTALITY line, kept on the draft so posting the day records it on the
-- animal (its disposal reason) and the batch transaction. Null on every other row. Additive.
ALTER TABLE `batch_daily_data` ADD COLUMN `reason_id` varchar(36) NULL DEFAULT NULL;
