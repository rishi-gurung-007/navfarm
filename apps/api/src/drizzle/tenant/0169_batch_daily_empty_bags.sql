-- Workbook checkpoint 28 (Bag reconciliation, POST Day): the empty bags a farm
-- counted for a bagged feed entry, kept beside the quantity posted so the bags
-- times the configured bag size can be compared with the posted consumption.
-- Nullable and additive; entries without a count are unchanged.
ALTER TABLE `batch_daily_data` ADD `empty_bags` int;
