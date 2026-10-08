-- Goods Issue is retired: stock that leaves a location is recorded through batch
-- entries, Transfer Orders and Stock Adjustments. The inventory ledger rows and
-- journals the old documents posted stay as they are; only the documents go.
DELETE FROM `role_permissions` WHERE `resource` = 'GOODS_ISSUE';
--> statement-breakpoint
DROP TABLE IF EXISTS `goods_issue_line`;
--> statement-breakpoint
DROP TABLE IF EXISTS `goods_issue`;
