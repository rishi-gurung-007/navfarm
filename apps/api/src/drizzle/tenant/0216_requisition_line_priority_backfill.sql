-- Requisition row 34: a feed requisition drafted from a saved calculation stored
-- its lines without a priority, so the sheet showed "Not available" and the
-- approval went out as MEDIUM. createFromRun now sets it; this fills the lines
-- already made, by the rule requisitionPriority applies: a silo at or below its
-- low level is Urgent, else the days from the run's planning date to the line's
-- first shortage (< 3 Critical, < 7 Warning, otherwise or none Info). Only lines
-- with no priority are touched.
UPDATE `requisition_line` rl
JOIN `requisition` r ON r.`requisition_id` = rl.`requisition_id`
JOIN `feed_forecast_run` fr ON fr.`run_id` = r.`feed_forecast_run_id`
LEFT JOIN `location_master` lm ON lm.`location_id` = rl.`destination_location_id`
SET rl.`priority` = CASE
  WHEN lm.`location_type` <> 'STORE' AND lm.`low_level_kg` IS NOT NULL AND rl.`system_balance_kg` <= lm.`low_level_kg` THEN 'CRITICAL_FIRST_PRIORITY'
  WHEN rl.`first_shortage_date` IS NULL THEN 'INFO'
  WHEN DATEDIFF(rl.`first_shortage_date`, fr.`planning_date`) < 3 THEN 'CRITICAL'
  WHEN DATEDIFF(rl.`first_shortage_date`, fr.`planning_date`) < 7 THEN 'WARNING'
  ELSE 'INFO'
END
WHERE r.`doc_type` = 'FEED' AND rl.`priority` IS NULL;
