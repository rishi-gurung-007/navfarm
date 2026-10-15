-- ============================================================================
-- Disabled items: what can be deleted, and what must stay.
-- Generated from the live foreign keys on item_master: 30 tables reference it
-- with ON DELETE RESTRICT, so any item with history cannot be deleted at all.
--
-- Run STEP 1, choose your set, then STEP 2 (read-only). Only run STEP 3 once
-- STEP 2's list looks right. Uses zz_ working tables, dropped again in STEP 4.
-- ============================================================================
USE nf_portatestnavfarm;

-- --- STEP 1 ---------------------------------------------------- read-only --
-- "Disabled" is not one flag. Decide which of these you mean.
SELECT
  SUM(deleted_at IS NOT NULL)               AS soft_deleted,
  SUM(is_active = 0 AND deleted_at IS NULL) AS inactive_not_deleted,
  SUM(is_active = 0 AND status = 'DRAFT')   AS unfinished_drafts,
  SUM(is_blocked = 1)                       AS blocked,
  COUNT(*)                                  AS all_items
FROM item_master;

-- --- STEP 2 ---------------------------------------------------- read-only --
DROP TABLE IF EXISTS zz_disabled_items;
CREATE TABLE zz_disabled_items (
  item_id VARCHAR(36) PRIMARY KEY, item_code VARCHAR(100), item_name VARCHAR(255)
);

-- EDIT THE WHERE CLAUSE to match the set you chose above.
INSERT INTO zz_disabled_items (item_id, item_code, item_name)
SELECT item_id, item_code, item_name FROM item_master
WHERE deleted_at IS NOT NULL;        -- or: is_active = 0 — or: is_blocked = 1

DROP TABLE IF EXISTS zz_items_in_use;
CREATE TABLE zz_items_in_use (item_id VARCHAR(36) PRIMARY KEY);

INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.default_item_id FROM activity_master t JOIN zz_disabled_items d ON d.item_id = t.default_item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM animal_medication_log t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM animal_register t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM batch_cost_variance t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM batch_input_line t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM batch_output_line t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM batch_standard_consumption_line t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM batch_transaction t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.feed_item_id FROM bin_diet_assignment t JOIN zz_disabled_items d ON d.item_id = t.feed_item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.bio_asset_item_id FROM bio_asset_ledger t JOIN zz_disabled_items d ON d.item_id = t.bio_asset_item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.feed_item_id FROM breed_lifecycle_stages t JOIN zz_disabled_items d ON d.item_id = t.feed_item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.output_item_id FROM breed_lifecycle_stages t JOIN zz_disabled_items d ON d.item_id = t.output_item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM farm_record t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM feed_consolidation_line t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.current_item_id FROM feed_forecast_run_line t JOIN zz_disabled_items d ON d.item_id = t.current_item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.required_item_id FROM feed_forecast_run_line t JOIN zz_disabled_items d ON d.item_id = t.required_item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM feed_formula_ingredients t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.target_item_id FROM feed_formula_master t JOIN zz_disabled_items d ON d.item_id = t.target_item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM feed_loading_sheet t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM feed_plan_line t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM feed_stock_count_line t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM goods_receipt_line t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM inventory_application t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM inventory_ledger t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM parameter_master t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM qr_code_master t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM scheduler_line t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM stock_adjustment_line t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM stock_transfer_line t JOIN zz_disabled_items d ON d.item_id = t.item_id;
INSERT IGNORE INTO zz_items_in_use (item_id) SELECT DISTINCT t.item_id FROM system_scheduler_line t JOIN zz_disabled_items d ON d.item_id = t.item_id;

-- What will happen to each disabled item.
SELECT d.item_code, d.item_name,
       CASE WHEN u.item_id IS NULL THEN 'DELETABLE' ELSE 'IN USE - will be kept' END AS verdict
FROM zz_disabled_items d
LEFT JOIN zz_items_in_use u ON u.item_id = d.item_id
ORDER BY verdict, d.item_code;

SELECT COUNT(*) AS deletable FROM zz_disabled_items d
  LEFT JOIN zz_items_in_use u ON u.item_id = d.item_id WHERE u.item_id IS NULL;
SELECT COUNT(*) AS kept_because_in_use FROM zz_items_in_use;

-- Exactly where the kept ones are still referenced.
SELECT * FROM (
  SELECT 'activity_master.default_item_id' AS referenced_by, COUNT(*) AS n FROM activity_master t JOIN zz_disabled_items d ON d.item_id = t.default_item_id
  UNION ALL   SELECT 'animal_medication_log.item_id' AS referenced_by, COUNT(*) AS n FROM animal_medication_log t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'animal_register.item_id' AS referenced_by, COUNT(*) AS n FROM animal_register t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'batch_cost_variance.item_id' AS referenced_by, COUNT(*) AS n FROM batch_cost_variance t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'batch_input_line.item_id' AS referenced_by, COUNT(*) AS n FROM batch_input_line t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'batch_output_line.item_id' AS referenced_by, COUNT(*) AS n FROM batch_output_line t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'batch_standard_consumption_line.item_id' AS referenced_by, COUNT(*) AS n FROM batch_standard_consumption_line t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'batch_transaction.item_id' AS referenced_by, COUNT(*) AS n FROM batch_transaction t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'bin_diet_assignment.feed_item_id' AS referenced_by, COUNT(*) AS n FROM bin_diet_assignment t JOIN zz_disabled_items d ON d.item_id = t.feed_item_id
  UNION ALL   SELECT 'bio_asset_ledger.bio_asset_item_id' AS referenced_by, COUNT(*) AS n FROM bio_asset_ledger t JOIN zz_disabled_items d ON d.item_id = t.bio_asset_item_id
  UNION ALL   SELECT 'breed_lifecycle_stages.feed_item_id' AS referenced_by, COUNT(*) AS n FROM breed_lifecycle_stages t JOIN zz_disabled_items d ON d.item_id = t.feed_item_id
  UNION ALL   SELECT 'breed_lifecycle_stages.output_item_id' AS referenced_by, COUNT(*) AS n FROM breed_lifecycle_stages t JOIN zz_disabled_items d ON d.item_id = t.output_item_id
  UNION ALL   SELECT 'farm_record.item_id' AS referenced_by, COUNT(*) AS n FROM farm_record t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'feed_consolidation_line.item_id' AS referenced_by, COUNT(*) AS n FROM feed_consolidation_line t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'feed_forecast_run_line.current_item_id' AS referenced_by, COUNT(*) AS n FROM feed_forecast_run_line t JOIN zz_disabled_items d ON d.item_id = t.current_item_id
  UNION ALL   SELECT 'feed_forecast_run_line.required_item_id' AS referenced_by, COUNT(*) AS n FROM feed_forecast_run_line t JOIN zz_disabled_items d ON d.item_id = t.required_item_id
  UNION ALL   SELECT 'feed_formula_ingredients.item_id' AS referenced_by, COUNT(*) AS n FROM feed_formula_ingredients t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'feed_formula_master.target_item_id' AS referenced_by, COUNT(*) AS n FROM feed_formula_master t JOIN zz_disabled_items d ON d.item_id = t.target_item_id
  UNION ALL   SELECT 'feed_loading_sheet.item_id' AS referenced_by, COUNT(*) AS n FROM feed_loading_sheet t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'feed_plan_line.item_id' AS referenced_by, COUNT(*) AS n FROM feed_plan_line t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'feed_stock_count_line.item_id' AS referenced_by, COUNT(*) AS n FROM feed_stock_count_line t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'goods_receipt_line.item_id' AS referenced_by, COUNT(*) AS n FROM goods_receipt_line t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'inventory_application.item_id' AS referenced_by, COUNT(*) AS n FROM inventory_application t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'inventory_ledger.item_id' AS referenced_by, COUNT(*) AS n FROM inventory_ledger t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'parameter_master.item_id' AS referenced_by, COUNT(*) AS n FROM parameter_master t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'qr_code_master.item_id' AS referenced_by, COUNT(*) AS n FROM qr_code_master t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'scheduler_line.item_id' AS referenced_by, COUNT(*) AS n FROM scheduler_line t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'stock_adjustment_line.item_id' AS referenced_by, COUNT(*) AS n FROM stock_adjustment_line t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'stock_transfer_line.item_id' AS referenced_by, COUNT(*) AS n FROM stock_transfer_line t JOIN zz_disabled_items d ON d.item_id = t.item_id
  UNION ALL   SELECT 'system_scheduler_line.item_id' AS referenced_by, COUNT(*) AS n FROM system_scheduler_line t JOIN zz_disabled_items d ON d.item_id = t.item_id
) u WHERE n > 0 ORDER BY n DESC;

-- --- STEP 3 ------------------------------------------------------- writes --
START TRANSACTION;

DELETE iav FROM item_attribute_values iav
  JOIN zz_disabled_items d ON d.item_id = iav.item_id
  LEFT JOIN zz_items_in_use u ON u.item_id = d.item_id WHERE u.item_id IS NULL;

DELETE ucm FROM uom_conversion_master ucm
  JOIN zz_disabled_items d ON d.item_id = ucm.item_id
  LEFT JOIN zz_items_in_use u ON u.item_id = d.item_id WHERE u.item_id IS NULL;

DELETE im FROM item_master im
  JOIN zz_disabled_items d ON d.item_id = im.item_id
  LEFT JOIN zz_items_in_use u ON u.item_id = d.item_id WHERE u.item_id IS NULL;

SELECT ROW_COUNT() AS items_deleted;
COMMIT;   -- or ROLLBACK; if the number is not what STEP 2 promised

-- --- STEP 4 ------------------------------------------------------ cleanup --
DROP TABLE IF EXISTS zz_disabled_items;
DROP TABLE IF EXISTS zz_items_in_use;
