-- D23 (Rishi, 27 Sep): system (seeded) stages missing a duration or a next
-- stage leave the Feed Forecast unable to date a stage change ("24/09/26 –
-- —"). Only EMPTY values on is_system rows are filled, never a tester's:
-- the four stages BBP §1.7 gives only as a range take the demo lifecycle's
-- own lengths (open question S7: DRY_SOW 7, FLUSH 14, FARROWING 3, WEANING 1
-- — demo-feed-defaults.ts), and the grow-out chain WEANER -> GROWER ->
-- FINISHER is linked within the same tenant, LOB and company scope.
UPDATE `stage_master`
SET `typical_duration_days` = CASE `stage_code`
    WHEN 'DRY_SOW' THEN 7
    WHEN 'FLUSH' THEN 14
    WHEN 'FARROWING' THEN 3
    WHEN 'WEANING' THEN 1
  END
WHERE `is_system` = 1
  AND `deleted_at` IS NULL
  AND `typical_duration_days` IS NULL
  AND `stage_code` IN ('DRY_SOW', 'FLUSH', 'FARROWING', 'WEANING');
--> statement-breakpoint
UPDATE `stage_master` s
JOIN `stage_master` n
  ON n.`tenant_id` = s.`tenant_id`
 AND n.`lob_id` = s.`lob_id`
 AND n.`company_id` <=> s.`company_id`
 AND n.`deleted_at` IS NULL
 AND n.`stage_code` = CASE s.`stage_code` WHEN 'WEANER' THEN 'GROWER' WHEN 'GROWER' THEN 'FINISHER' END
SET s.`next_stage_id` = n.`stage_id`
WHERE s.`is_system` = 1
  AND s.`deleted_at` IS NULL
  AND s.`next_stage_id` IS NULL
  AND s.`stage_code` IN ('WEANER', 'GROWER');
