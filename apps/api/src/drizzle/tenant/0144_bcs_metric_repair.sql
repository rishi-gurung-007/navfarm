-- Data repair, nothing structural. The seeded activity 'Body Condition Score (BCS)' carried the KPI code 'BCS', which
-- no scheduler line accepts (the codes are BODY_WEIGHT, BCS_SCORE, ...). The schedule form dropped the unknown code
-- and fell back to the first option, BODY_WEIGHT, so every line made from that activity recorded a 1-5 score as
-- kilograms. Only the exact mislabel is touched: the code 'BCS' on the activity, and lines still named after the
-- activity that were left on BODY_WEIGHT. Values already posted are history and are not rewritten.
UPDATE `activity_master` SET `default_kpi_metric` = 'BCS_SCORE' WHERE `default_kpi_metric` = 'BCS';
--> statement-breakpoint
UPDATE `scheduler_line` SET `kpi_metric` = 'BCS_SCORE', `kpi_uom` = 'SCORE' WHERE `activity_name` = 'Body Condition Score (BCS)' AND `kpi_metric` = 'BODY_WEIGHT';
--> statement-breakpoint
UPDATE `system_scheduler_line` SET `kpi_metric` = 'BCS_SCORE', `kpi_uom` = 'SCORE' WHERE `activity_name` = 'Body Condition Score (BCS)' AND `kpi_metric` = 'BODY_WEIGHT';
