-- D22 / D27 (Rishi, 27 Sep): a silo must carry both feed levels. Existing
-- silos without them get High = 90 % of capacity (workbook Master Setup §1
-- row 12) and Low = 20 % (confirmed by Rishi, D27) — only where the level is
-- empty, and never where the default would break low < high against a value
-- someone already set (that silo keeps its empty level and the form asks for
-- it). silo_capacity_kg is kilograms whatever unit was typed: the location
-- service converts on save (checked in Plan A). Editable afterwards.
UPDATE `location_master`
SET `high_level_kg` = ROUND(`silo_capacity_kg` * 0.90, 2)
WHERE `location_type` = 'SILO'
  AND `high_level_kg` IS NULL
  AND `silo_capacity_kg` > 0
  AND (`low_level_kg` IS NULL OR ROUND(`silo_capacity_kg` * 0.90, 2) > `low_level_kg`);
--> statement-breakpoint
UPDATE `location_master`
SET `low_level_kg` = ROUND(`silo_capacity_kg` * 0.20, 2)
WHERE `location_type` = 'SILO'
  AND `low_level_kg` IS NULL
  AND `silo_capacity_kg` > 0
  AND (`high_level_kg` IS NULL OR ROUND(`silo_capacity_kg` * 0.20, 2) < `high_level_kg`);
