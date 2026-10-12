-- Tasks 1 & 12: Normalize legacy alert role HEAD_OF_FARM to OPERATIONAL_ADMIN in alert rules and feed alerts
UPDATE `alert_rule`
   SET `escalation_role` = 'OPERATIONAL_ADMIN'
 WHERE `escalation_role` = 'HEAD_OF_FARM';--> statement-breakpoint
UPDATE `alert_rule`
   SET `recipient_roles` = CAST(REPLACE(CAST(`recipient_roles` AS CHAR), '"HEAD_OF_FARM"', '"OPERATIONAL_ADMIN"') AS JSON)
 WHERE JSON_CONTAINS(`recipient_roles`, '"HEAD_OF_FARM"');--> statement-breakpoint
UPDATE `feed_alert`
   SET `escalation_role` = 'OPERATIONAL_ADMIN'
 WHERE `escalation_role` = 'HEAD_OF_FARM';--> statement-breakpoint
UPDATE `feed_alert`
   SET `recipient_roles` = CAST(REPLACE(CAST(`recipient_roles` AS CHAR), '"HEAD_OF_FARM"', '"OPERATIONAL_ADMIN"') AS JSON)
 WHERE JSON_CONTAINS(`recipient_roles`, '"HEAD_OF_FARM"');
