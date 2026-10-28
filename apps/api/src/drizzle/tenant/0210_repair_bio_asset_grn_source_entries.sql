-- Repair the historical 0200 backfill for tenants where the same biological item
-- appears on multiple GRN lines. Existing acquisition rows are reassigned by
-- deterministic registration order across the cumulative GRN line quantities.
UPDATE `bio_asset_ledger` b
JOIN `animal_register` a ON a.`animal_id` = b.`animal_id`
JOIN (
  SELECT r.`animal_id`, r.`source_receipt_id`, r.`item_id`, r.`registration_no`
  FROM (
    SELECT a2.`animal_id`, a2.`source_receipt_id`, a2.`item_id`,
      ROW_NUMBER() OVER (
        PARTITION BY a2.`source_receipt_id`, a2.`item_id`
        ORDER BY a2.`entry_date`, a2.`created_at`, a2.`animal_id`
      ) AS `registration_no`
    FROM `animal_register` a2
    WHERE a2.`source_receipt_id` IS NOT NULL
  ) r
) registered ON registered.`animal_id` = a.`animal_id`
JOIN (
  SELECT p.`entry_id`, gl.`receipt_id`, gl.`item_id`,
    SUM(gl.`quantity`) OVER (
      PARTITION BY gl.`receipt_id`, gl.`item_id` ORDER BY gl.`line_no`
    ) AS `line_cumulative`,
    SUM(gl.`quantity`) OVER (
      PARTITION BY gl.`receipt_id`, gl.`item_id` ORDER BY gl.`line_no`
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS `line_before`
  FROM `bio_asset_ledger` p
  JOIN `goods_receipt_line` gl ON gl.`line_id` = p.`document_line_id`
  WHERE p.`entry_type` = 'PURCHASE'
) source_line ON source_line.`receipt_id` = registered.`source_receipt_id`
  AND source_line.`item_id` = registered.`item_id`
  AND registered.`registration_no` > COALESCE(source_line.`line_before`, 0)
  AND registered.`registration_no` <= source_line.`line_cumulative`
SET b.`source_entry_id` = source_line.`entry_id`
WHERE b.`entry_type` = 'ACQUISITION';
