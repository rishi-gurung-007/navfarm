-- D21 (Rishi, 27 Sep): a batch with no shed is fed from the farm store in
-- the Feed Forecast. On existing data the shed is set only where it is
-- certain, and never over a shed someone chose:
--   (1) every live animal of the batch stands in one shed (the shed, or a
--       pen/crate under it), or
--   (2) no placed live animal says otherwise and every scheduler header of
--       the batch that names a location names the same one shed.
-- The shed must be an active SHED of the batch's company and farm; a batch
-- with no farm takes the shed's. Anything ambiguous is left alone and keeps
-- the "no shed on record" note; batch edit (PATCH /batch/:id/shed) sets it.
UPDATE `batch_header` b
JOIN (
  SELECT x.`batch_id`, MIN(x.`shed_id`) AS `shed_id`
  FROM (
    SELECT a.`current_batch_id` AS `batch_id`,
           COALESCE(IF(l.`location_type` = 'SHED', l.`location_id`, NULL),
                    IF(p.`location_type` = 'SHED', p.`location_id`, NULL),
                    IF(g.`location_type` = 'SHED', g.`location_id`, NULL)) AS `shed_id`
    FROM `animal_register` a
    LEFT JOIN `location_master` l ON l.`location_id` = a.`current_location_id`
    LEFT JOIN `location_master` p ON p.`location_id` = l.`parent_location_id`
    LEFT JOIN `location_master` g ON g.`location_id` = p.`parent_location_id`
    WHERE a.`current_batch_id` IS NOT NULL
      AND a.`status` NOT IN ('DEAD', 'SOLD', 'CULLED', 'SLAUGHTERED')
  ) x
  GROUP BY x.`batch_id`
  HAVING COUNT(*) = COUNT(x.`shed_id`) AND COUNT(DISTINCT x.`shed_id`) = 1
) s ON s.`batch_id` = b.`batch_id`
JOIN `location_master` sh ON sh.`location_id` = s.`shed_id`
SET b.`shed_id` = s.`shed_id`,
    b.`farm_id` = COALESCE(b.`farm_id`, sh.`farm_id`, sh.`parent_location_id`)
WHERE b.`shed_id` IS NULL
  AND b.`deleted_at` IS NULL
  AND sh.`location_type` = 'SHED'
  AND sh.`is_active` = 1
  AND sh.`deleted_at` IS NULL
  AND sh.`company_id` = b.`company_id`
  AND (b.`farm_id` IS NULL OR b.`farm_id` = COALESCE(sh.`farm_id`, sh.`parent_location_id`));
--> statement-breakpoint
UPDATE `batch_header` b
JOIN (
  SELECT y.`batch_id`, MIN(y.`shed_id`) AS `shed_id`
  FROM (
    SELECT h.`batch_id`,
           COALESCE(IF(l.`location_type` = 'SHED', l.`location_id`, NULL),
                    IF(p.`location_type` = 'SHED', p.`location_id`, NULL),
                    IF(g.`location_type` = 'SHED', g.`location_id`, NULL)) AS `shed_id`
    FROM `scheduler_header` h
    JOIN `location_master` l ON l.`location_id` = h.`location_id`
    LEFT JOIN `location_master` p ON p.`location_id` = l.`parent_location_id`
    LEFT JOIN `location_master` g ON g.`location_id` = p.`parent_location_id`
  ) y
  GROUP BY y.`batch_id`
  HAVING COUNT(*) = COUNT(y.`shed_id`) AND COUNT(DISTINCT y.`shed_id`) = 1
) s ON s.`batch_id` = b.`batch_id`
JOIN `location_master` sh ON sh.`location_id` = s.`shed_id`
SET b.`shed_id` = s.`shed_id`,
    b.`farm_id` = COALESCE(b.`farm_id`, sh.`farm_id`, sh.`parent_location_id`)
WHERE b.`shed_id` IS NULL
  AND b.`deleted_at` IS NULL
  AND sh.`location_type` = 'SHED'
  AND sh.`is_active` = 1
  AND sh.`deleted_at` IS NULL
  AND sh.`company_id` = b.`company_id`
  AND (b.`farm_id` IS NULL OR b.`farm_id` = COALESCE(sh.`farm_id`, sh.`parent_location_id`))
  AND NOT EXISTS (
    SELECT 1
    FROM `animal_register` a
    LEFT JOIN `location_master` l2 ON l2.`location_id` = a.`current_location_id`
    LEFT JOIN `location_master` p2 ON p2.`location_id` = l2.`parent_location_id`
    LEFT JOIN `location_master` g2 ON g2.`location_id` = p2.`parent_location_id`
    WHERE a.`current_batch_id` = b.`batch_id`
      AND a.`status` NOT IN ('DEAD', 'SOLD', 'CULLED', 'SLAUGHTERED')
      AND a.`current_location_id` IS NOT NULL
      AND NOT (COALESCE(IF(l2.`location_type` = 'SHED', l2.`location_id`, NULL),
                        IF(p2.`location_type` = 'SHED', p2.`location_id`, NULL),
                        IF(g2.`location_type` = 'SHED', g2.`location_id`, NULL)) <=> s.`shed_id`)
  );
