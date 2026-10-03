-- Review finding (Important 1, Task 9): 0143 widened days_remaining INT -> decimal(6,1) for the
-- workbook's one-decimal display (Silo Balance row 9), but decimal(6,1) caps at 99,999.9 where INT
-- held up to 2,147,483,647. dec() in feed-requisition.service.ts stringifies without clamping, so an
-- out-of-range value (a large safety stock against a near-zero daily demand) would make MySQL raise
-- under strict mode and roll back the whole auto-draft transaction. Widen further to decimal(10,1),
-- which keeps the display precision and restores effectively unbounded range. A widening MODIFY
-- preserves every existing value: additive, not a drop.
ALTER TABLE `requisition_line` MODIFY COLUMN `days_remaining` decimal(10,1);
