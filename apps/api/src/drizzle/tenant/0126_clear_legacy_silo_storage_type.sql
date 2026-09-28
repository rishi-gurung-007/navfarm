-- D28 (Rishi, 27 Sep 2026): pens, sheds and crates loaded from the old location
-- template carry storage_type = 'SILO', which made every save of them demand silo
-- capacity. Silo rules follow the location type now; this clears the stale value on
-- rows that are not a SILO or a STORE. No other column is touched.
UPDATE `location_master`
SET `storage_type` = NULL
WHERE `storage_type` = 'SILO'
  AND `location_type` NOT IN ('SILO', 'STORE');
