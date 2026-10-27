-- 0212 copied every requisition's priority onto its lines, and nothing reads
-- the header column any more (row 34 is per line). Run the two in order and no
-- priority is lost.
ALTER TABLE `requisition` DROP COLUMN `priority`;
