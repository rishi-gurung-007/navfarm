-- Requisition §1 row 34 moves from the header to each line: the mill prepares
-- and produces each requested feed in turn, so the urgency belongs to the feed
-- line, not the document. Every existing line takes its requisition's priority
-- as it stands, the farm's escalation included, so nothing a user set is lost;
-- 0213 drops the header column only after this has copied it.
ALTER TABLE `requisition_line` ADD `priority` varchar(30);
--> statement-breakpoint
UPDATE `requisition_line` rl
JOIN `requisition` r ON r.`requisition_id` = rl.`requisition_id`
SET rl.`priority` = r.`priority`
WHERE r.`priority` IS NOT NULL AND rl.`priority` IS NULL;
