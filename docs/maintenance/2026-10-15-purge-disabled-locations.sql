-- ============================================================================
-- Disabled locations: what can be deleted, and what must stay.
-- Generated from the live foreign keys on location_master: 49 columns across
-- 28 tables reference it — 35 ON DELETE RESTRICT (these block a delete),
-- 11 SET NULL (these quietly blank a column on a row you are keeping) and
-- 3 CASCADE (these delete rows you did not ask to delete). STEP 2B prints
-- what the last two will do before STEP 3 does it.
--
-- Run STEP 1, choose your set, then STEP 2 / 2A / 2B / 2C (all read-only).
-- Only run STEP 3 once STEP 2's list looks right. Uses zz_ working tables,
-- dropped again in STEP 4.
-- ============================================================================
USE nf_portatestnavfarm;

-- --- STEP 1 ---------------------------------------------------- read-only --
-- "Disabled" is not one flag, same as item_master. Decide which you mean.
SELECT
  SUM(deleted_at IS NOT NULL)                   AS soft_deleted,
  SUM(is_active = 0 AND deleted_at IS NULL)     AS inactive_not_deleted,
  SUM(is_active = 0 AND status = 'DRAFT')       AS unfinished_drafts,
  SUM(is_active = 1 AND deleted_at IS NOT NULL) AS active_but_deleted,
  COUNT(*)                                      AS all_locations
FROM location_master;

-- --- STEP 2 ---------------------------------------------------- read-only --
DROP TABLE IF EXISTS zz_disabled_locations;
CREATE TABLE zz_disabled_locations (
  location_id VARCHAR(36) PRIMARY KEY, location_code VARCHAR(255),
  location_name VARCHAR(200), location_type VARCHAR(50), location_level INT
);

-- EDIT THE WHERE CLAUSE to match the set you chose above.
-- As written this is the 11 rows the Locations grid shows with the toggle off.
INSERT INTO zz_disabled_locations (location_id, location_code, location_name, location_type, location_level)
SELECT location_id, location_code, location_name, location_type, location_level
FROM location_master
WHERE is_active = 0 OR status = 'INACTIVE' OR deleted_at IS NOT NULL;

DROP TABLE IF EXISTS zz_locations_in_use;
CREATE TABLE zz_locations_in_use (location_id VARCHAR(36) PRIMARY KEY);

-- The 31 RESTRICT columns that live in other tables.
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.current_location_id FROM animal_register t JOIN zz_disabled_locations d ON d.location_id = t.current_location_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM batch_header t JOIN zz_disabled_locations d ON d.location_id = t.farm_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.location_id FROM batch_header t JOIN zz_disabled_locations d ON d.location_id = t.location_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.shed_id FROM batch_header t JOIN zz_disabled_locations d ON d.location_id = t.shed_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.location_id FROM batch_mortality_detail t JOIN zz_disabled_locations d ON d.location_id = t.location_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.warehouse_id FROM batch_output_line t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.bin_location_id FROM bin_diet_assignment t JOIN zz_disabled_locations d ON d.location_id = t.bin_location_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM breed_lifecycle_stages t JOIN zz_disabled_locations d ON d.location_id = t.farm_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.destination_silo_id FROM feed_consolidation_line t JOIN zz_disabled_locations d ON d.location_id = t.destination_silo_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM feed_consolidation_line t JOIN zz_disabled_locations d ON d.location_id = t.farm_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM feed_forecast_run t JOIN zz_disabled_locations d ON d.location_id = t.farm_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.destination_location_id FROM feed_forecast_run_line t JOIN zz_disabled_locations d ON d.location_id = t.destination_location_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.shed_id FROM feed_forecast_run_line t JOIN zz_disabled_locations d ON d.location_id = t.shed_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.destination_silo_id FROM feed_loading_sheet t JOIN zz_disabled_locations d ON d.location_id = t.destination_silo_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM feed_loading_sheet t JOIN zz_disabled_locations d ON d.location_id = t.farm_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.mill_loading_bin_id FROM feed_loading_sheet t JOIN zz_disabled_locations d ON d.location_id = t.mill_loading_bin_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM feed_plan t JOIN zz_disabled_locations d ON d.location_id = t.farm_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM feed_planning_setting t JOIN zz_disabled_locations d ON d.location_id = t.farm_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM feed_stock_count t JOIN zz_disabled_locations d ON d.location_id = t.farm_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.silo_id FROM feed_stock_count_line t JOIN zz_disabled_locations d ON d.location_id = t.silo_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.warehouse_id FROM goods_receipt t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.location_id FROM inventory_ledger t JOIN zz_disabled_locations d ON d.location_id = t.location_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.warehouse_id FROM inventory_ledger t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM operational_area_master t JOIN zz_disabled_locations d ON d.location_id = t.farm_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.warehouse_id FROM qr_code_master t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM resource_ledger t JOIN zz_disabled_locations d ON d.location_id = t.farm_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.location_id FROM scheduler_header t JOIN zz_disabled_locations d ON d.location_id = t.location_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.warehouse_id FROM stock_adjustment t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.from_warehouse_id FROM stock_transfer t JOIN zz_disabled_locations d ON d.location_id = t.from_warehouse_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.to_warehouse_id FROM stock_transfer t JOIN zz_disabled_locations d ON d.location_id = t.to_warehouse_id;
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM user_master t JOIN zz_disabled_locations d ON d.location_id = t.farm_id;

-- The 4 RESTRICT columns location_master points at itself with. A disabled
-- parent is only blocked by a child that is SURVIVING: a child that is itself
-- being deleted goes first and releases the parent. "Surviving" depends on
-- this same table, so the block is run three times — deeper than the
-- FARM > SHED > PEN hierarchy goes, so it settles.
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.parent_location_id FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.parent_location_id WHERE t.location_id NOT IN (SELECT location_id FROM zz_disabled_locations) OR t.location_id IN (SELECT location_id FROM zz_locations_in_use);
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.farm_id WHERE t.location_id NOT IN (SELECT location_id FROM zz_disabled_locations) OR t.location_id IN (SELECT location_id FROM zz_locations_in_use);
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.shed_id FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.shed_id WHERE t.location_id NOT IN (SELECT location_id FROM zz_disabled_locations) OR t.location_id IN (SELECT location_id FROM zz_locations_in_use);
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.warehouse_id FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id WHERE t.location_id NOT IN (SELECT location_id FROM zz_disabled_locations) OR t.location_id IN (SELECT location_id FROM zz_locations_in_use);
-- pass 2
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.parent_location_id FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.parent_location_id WHERE t.location_id NOT IN (SELECT location_id FROM zz_disabled_locations) OR t.location_id IN (SELECT location_id FROM zz_locations_in_use);
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.farm_id WHERE t.location_id NOT IN (SELECT location_id FROM zz_disabled_locations) OR t.location_id IN (SELECT location_id FROM zz_locations_in_use);
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.shed_id FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.shed_id WHERE t.location_id NOT IN (SELECT location_id FROM zz_disabled_locations) OR t.location_id IN (SELECT location_id FROM zz_locations_in_use);
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.warehouse_id FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id WHERE t.location_id NOT IN (SELECT location_id FROM zz_disabled_locations) OR t.location_id IN (SELECT location_id FROM zz_locations_in_use);
-- pass 3
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.parent_location_id FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.parent_location_id WHERE t.location_id NOT IN (SELECT location_id FROM zz_disabled_locations) OR t.location_id IN (SELECT location_id FROM zz_locations_in_use);
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.farm_id FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.farm_id WHERE t.location_id NOT IN (SELECT location_id FROM zz_disabled_locations) OR t.location_id IN (SELECT location_id FROM zz_locations_in_use);
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.shed_id FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.shed_id WHERE t.location_id NOT IN (SELECT location_id FROM zz_disabled_locations) OR t.location_id IN (SELECT location_id FROM zz_locations_in_use);
INSERT IGNORE INTO zz_locations_in_use (location_id) SELECT DISTINCT t.warehouse_id FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id WHERE t.location_id NOT IN (SELECT location_id FROM zz_disabled_locations) OR t.location_id IN (SELECT location_id FROM zz_locations_in_use);

-- What will happen to each disabled location.
SELECT d.location_code, d.location_name, d.location_type, d.location_level,
       CASE WHEN u.location_id IS NULL THEN 'DELETABLE' ELSE 'IN USE - will be kept' END AS verdict
FROM zz_disabled_locations d
LEFT JOIN zz_locations_in_use u ON u.location_id = d.location_id
ORDER BY verdict, d.location_code;

SELECT COUNT(*) AS deletable FROM zz_disabled_locations d
  LEFT JOIN zz_locations_in_use u ON u.location_id = d.location_id WHERE u.location_id IS NULL;
SELECT COUNT(*) AS kept_because_in_use FROM zz_locations_in_use;

-- --- STEP 2A --------------------------------------------------- read-only --
-- Exactly where the kept ones are still referenced.
SELECT * FROM (
  SELECT 'animal_register.current_location_id' AS referenced_by, COUNT(*) AS n FROM animal_register t JOIN zz_disabled_locations d ON d.location_id = t.current_location_id
  UNION ALL SELECT 'batch_header.farm_id', COUNT(*) FROM batch_header t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'batch_header.location_id', COUNT(*) FROM batch_header t JOIN zz_disabled_locations d ON d.location_id = t.location_id
  UNION ALL SELECT 'batch_header.shed_id', COUNT(*) FROM batch_header t JOIN zz_disabled_locations d ON d.location_id = t.shed_id
  UNION ALL SELECT 'batch_mortality_detail.location_id', COUNT(*) FROM batch_mortality_detail t JOIN zz_disabled_locations d ON d.location_id = t.location_id
  UNION ALL SELECT 'batch_output_line.warehouse_id', COUNT(*) FROM batch_output_line t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id
  UNION ALL SELECT 'bin_diet_assignment.bin_location_id', COUNT(*) FROM bin_diet_assignment t JOIN zz_disabled_locations d ON d.location_id = t.bin_location_id
  UNION ALL SELECT 'breed_lifecycle_stages.farm_id', COUNT(*) FROM breed_lifecycle_stages t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'feed_consolidation_line.destination_silo_id', COUNT(*) FROM feed_consolidation_line t JOIN zz_disabled_locations d ON d.location_id = t.destination_silo_id
  UNION ALL SELECT 'feed_consolidation_line.farm_id', COUNT(*) FROM feed_consolidation_line t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'feed_forecast_run.farm_id', COUNT(*) FROM feed_forecast_run t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'feed_forecast_run_line.destination_location_id', COUNT(*) FROM feed_forecast_run_line t JOIN zz_disabled_locations d ON d.location_id = t.destination_location_id
  UNION ALL SELECT 'feed_forecast_run_line.shed_id', COUNT(*) FROM feed_forecast_run_line t JOIN zz_disabled_locations d ON d.location_id = t.shed_id
  UNION ALL SELECT 'feed_loading_sheet.destination_silo_id', COUNT(*) FROM feed_loading_sheet t JOIN zz_disabled_locations d ON d.location_id = t.destination_silo_id
  UNION ALL SELECT 'feed_loading_sheet.farm_id', COUNT(*) FROM feed_loading_sheet t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'feed_loading_sheet.mill_loading_bin_id', COUNT(*) FROM feed_loading_sheet t JOIN zz_disabled_locations d ON d.location_id = t.mill_loading_bin_id
  UNION ALL SELECT 'feed_plan.farm_id', COUNT(*) FROM feed_plan t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'feed_planning_setting.farm_id', COUNT(*) FROM feed_planning_setting t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'feed_stock_count.farm_id', COUNT(*) FROM feed_stock_count t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'feed_stock_count_line.silo_id', COUNT(*) FROM feed_stock_count_line t JOIN zz_disabled_locations d ON d.location_id = t.silo_id
  UNION ALL SELECT 'goods_receipt.warehouse_id', COUNT(*) FROM goods_receipt t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id
  UNION ALL SELECT 'inventory_ledger.location_id', COUNT(*) FROM inventory_ledger t JOIN zz_disabled_locations d ON d.location_id = t.location_id
  UNION ALL SELECT 'inventory_ledger.warehouse_id', COUNT(*) FROM inventory_ledger t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id
  UNION ALL SELECT 'location_master.parent_location_id', COUNT(*) FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.parent_location_id
  UNION ALL SELECT 'location_master.farm_id', COUNT(*) FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'location_master.shed_id', COUNT(*) FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.shed_id
  UNION ALL SELECT 'location_master.warehouse_id', COUNT(*) FROM location_master t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id
  UNION ALL SELECT 'operational_area_master.farm_id', COUNT(*) FROM operational_area_master t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'qr_code_master.warehouse_id', COUNT(*) FROM qr_code_master t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id
  UNION ALL SELECT 'resource_ledger.farm_id', COUNT(*) FROM resource_ledger t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'scheduler_header.location_id', COUNT(*) FROM scheduler_header t JOIN zz_disabled_locations d ON d.location_id = t.location_id
  UNION ALL SELECT 'stock_adjustment.warehouse_id', COUNT(*) FROM stock_adjustment t JOIN zz_disabled_locations d ON d.location_id = t.warehouse_id
  UNION ALL SELECT 'stock_transfer.from_warehouse_id', COUNT(*) FROM stock_transfer t JOIN zz_disabled_locations d ON d.location_id = t.from_warehouse_id
  UNION ALL SELECT 'stock_transfer.to_warehouse_id', COUNT(*) FROM stock_transfer t JOIN zz_disabled_locations d ON d.location_id = t.to_warehouse_id
  UNION ALL SELECT 'user_master.farm_id', COUNT(*) FROM user_master t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
) u WHERE n > 0 ORDER BY n DESC;

-- --- STEP 2B --------------------------------------------------- read-only --
-- Collateral. These do NOT block the delete, which is the danger: STEP 3 does
-- all of this silently. The rows counted here belong to records you are KEEPING.
SELECT * FROM (
  -- SET NULL: the row survives, the column is blanked. A requisition keeps its
  -- lines and quantities but forgets which farm it was for.
  SELECT 'alert_rule.farm_id' AS collateral, 'blanked (SET NULL)' AS effect, COUNT(*) AS n FROM alert_rule t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'animal_movement_log.from_location_id', 'blanked (SET NULL)', COUNT(*) FROM animal_movement_log t JOIN zz_disabled_locations d ON d.location_id = t.from_location_id
  UNION ALL SELECT 'animal_movement_log.to_location_id', 'blanked (SET NULL)', COUNT(*) FROM animal_movement_log t JOIN zz_disabled_locations d ON d.location_id = t.to_location_id
  UNION ALL SELECT 'requisition.farm_id', 'blanked (SET NULL)', COUNT(*) FROM requisition t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'requisition.from_location_id', 'blanked (SET NULL)', COUNT(*) FROM requisition t JOIN zz_disabled_locations d ON d.location_id = t.from_location_id
  UNION ALL SELECT 'requisition.main_location_id', 'blanked (SET NULL)', COUNT(*) FROM requisition t JOIN zz_disabled_locations d ON d.location_id = t.main_location_id
  UNION ALL SELECT 'requisition.to_location_id', 'blanked (SET NULL)', COUNT(*) FROM requisition t JOIN zz_disabled_locations d ON d.location_id = t.to_location_id
  UNION ALL SELECT 'requisition_line.destination_location_id', 'blanked (SET NULL)', COUNT(*) FROM requisition_line t JOIN zz_disabled_locations d ON d.location_id = t.destination_location_id
  UNION ALL SELECT 'requisition_line.from_location_id', 'blanked (SET NULL)', COUNT(*) FROM requisition_line t JOIN zz_disabled_locations d ON d.location_id = t.from_location_id
  UNION ALL SELECT 'requisition_line.to_location_id', 'blanked (SET NULL)', COUNT(*) FROM requisition_line t JOIN zz_disabled_locations d ON d.location_id = t.to_location_id
  UNION ALL SELECT 'requisition_line_batch.shed_id', 'blanked (SET NULL)', COUNT(*) FROM requisition_line_batch t JOIN zz_disabled_locations d ON d.location_id = t.shed_id
  -- CASCADE: the row is DELETED along with the location.
  UNION ALL SELECT 'feed_alert.farm_id', 'ROW DELETED (CASCADE)', COUNT(*) FROM feed_alert t JOIN zz_disabled_locations d ON d.location_id = t.farm_id
  UNION ALL SELECT 'silo_shed_link.shed_id', 'ROW DELETED (CASCADE)', COUNT(*) FROM silo_shed_link t JOIN zz_disabled_locations d ON d.location_id = t.shed_id
  UNION ALL SELECT 'silo_shed_link.silo_id', 'ROW DELETED (CASCADE)', COUNT(*) FROM silo_shed_link t JOIN zz_disabled_locations d ON d.location_id = t.silo_id
) c WHERE n > 0 ORDER BY effect DESC, n DESC;

-- --- STEP 2C --------------------------------------------------- read-only --
-- Columns that hold a location id with NO foreign key behind them. Nothing
-- stops the delete and nothing repairs them: they are left pointing at a row
-- that no longer exists. Known ones: batch_header.sub_location_id,
-- batch_stage_log.from/to_location_id, feed_schedule_log.farm_id,
-- inventory_ledger_line.warehouse_id, semen_batch.warehouse_id,
-- approval_request.farm_id. This lists whatever is actually there today.
SELECT c.TABLE_NAME, c.COLUMN_NAME
FROM information_schema.COLUMNS c
LEFT JOIN information_schema.KEY_COLUMN_USAGE k
  ON k.CONSTRAINT_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME
 AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME = 'location_master'
WHERE c.TABLE_SCHEMA = DATABASE()
  AND c.DATA_TYPE = 'varchar' AND c.CHARACTER_MAXIMUM_LENGTH = 36
  AND (c.COLUMN_NAME LIKE '%location\_id' OR c.COLUMN_NAME LIKE '%farm\_id'
    OR c.COLUMN_NAME LIKE '%shed\_id' OR c.COLUMN_NAME LIKE '%warehouse\_id'
    OR c.COLUMN_NAME LIKE '%silo\_id' OR c.COLUMN_NAME LIKE '%bin\_id')
  AND c.TABLE_NAME <> 'location_master'
  AND k.COLUMN_NAME IS NULL
ORDER BY c.TABLE_NAME, c.COLUMN_NAME;

-- --- STEP 3 ------------------------------------------------------- writes --
START TRANSACTION;

DROP TABLE IF EXISTS zz_locations_deletable;
CREATE TABLE zz_locations_deletable (location_id VARCHAR(36) PRIMARY KEY, location_level INT);
INSERT INTO zz_locations_deletable (location_id, location_level)
SELECT d.location_id, d.location_level FROM zz_disabled_locations d
LEFT JOIN zz_locations_in_use u ON u.location_id = d.location_id
WHERE u.location_id IS NULL;

-- Deepest first: a PEN goes before the SHED it hangs off, or the self
-- reference blocks the delete part-way through the statement.
DELETE FROM location_master
WHERE location_id IN (SELECT location_id FROM zz_locations_deletable)
ORDER BY location_level DESC;

SELECT ROW_COUNT() AS locations_deleted;
COMMIT;   -- or ROLLBACK; if the number is not what STEP 2 promised

-- --- STEP 4 ------------------------------------------------------ cleanup --
DROP TABLE IF EXISTS zz_disabled_locations;
DROP TABLE IF EXISTS zz_locations_in_use;
DROP TABLE IF EXISTS zz_locations_deletable;
