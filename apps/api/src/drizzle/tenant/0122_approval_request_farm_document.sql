-- D25 (Rishi, 27 Sep): feed requisitions are approved in the Approvals inbox,
-- by the farm's own approvers, farm-level users included. The engine reached
-- a farm only through batch_id, and a requisition has a farm but no batch, so
-- the inbox hid it from every restricted user (Plan B's Ruling C1 worked
-- round that by deciding in one step outside the inbox). farm_id scopes a
-- farm-level document; document_id names the document the request decides.
-- The UPDATE carries the two onto the requisitions Plan B already recorded,
-- only where both are still empty, so a re-run changes nothing.
ALTER TABLE `approval_request` ADD `farm_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `approval_request` ADD `document_id` varchar(36);
--> statement-breakpoint
CREATE INDEX `idx_approval_request_farm` ON `approval_request` (`farm_id`);
--> statement-breakpoint
CREATE INDEX `idx_approval_request_document` ON `approval_request` (`doc_type`,`document_id`);
--> statement-breakpoint
UPDATE `approval_request` ar
JOIN `requisition` r ON r.`approval_request_id` = ar.`request_id`
SET ar.`farm_id` = r.`farm_id`, ar.`document_id` = r.`requisition_id`
WHERE ar.`doc_type` = 'FEED_REQUISITION' AND ar.`farm_id` IS NULL AND ar.`document_id` IS NULL;
