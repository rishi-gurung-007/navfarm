-- Feed rows' period_from/period_to are STAGE DAYS (Rishi, 25 Sep 2026): the
-- scheduler and the feed forecast read them through stageDayRange as "days
-- since the pig entered the stage". Before this release the scheduler ignored
-- them (every feed line started at day 1), so rows were entered as the pig's
-- AGE — WEANER 28-70, GROWER 70-140 — and would now leave a batch unfed for
-- its first 27 or 69 days in the stage.
--
-- Each diet group (breed, stage, company, category, season, unit) whose
-- earliest active feed row starts after day 1 is shifted so it starts at 1,
-- keeping every row's length and the gaps between its rows. A group already
-- starting at 1 is untouched, so rows entered as stage days are kept as they
-- are. Only feed rows move; KPI-only rows are left alone.
UPDATE `breed_lifecycle_stages` l
JOIN (
  SELECT `breed_id`, `stage_id`,
         COALESCE(`company_id`, '') AS company_key,
         COALESCE(`category`, '') AS category_key,
         COALESCE(`season_type`, '') AS season_key,
         `calc_unit`,
         MIN(`period_from`) AS first_day
  FROM `breed_lifecycle_stages`
  WHERE `feed_item_id` IS NOT NULL AND `period_from` IS NOT NULL
  GROUP BY `breed_id`, `stage_id`, company_key, category_key, season_key, `calc_unit`
  HAVING MIN(`period_from`) > 1
) g
  ON  g.`breed_id` = l.`breed_id`
  AND g.`stage_id` = l.`stage_id`
  AND g.company_key = COALESCE(l.`company_id`, '')
  AND g.category_key = COALESCE(l.`category`, '')
  AND g.season_key = COALESCE(l.`season_type`, '')
  AND g.`calc_unit` <=> l.`calc_unit`
SET l.`period_from` = l.`period_from` - (g.first_day - 1),
    l.`period_to`   = CASE WHEN l.`period_to` IS NULL THEN NULL ELSE l.`period_to` - (g.first_day - 1) END
WHERE l.`feed_item_id` IS NOT NULL AND l.`period_from` IS NOT NULL;
--> statement-breakpoint
-- Stage day 0 does not exist (day 1 is the entry day); a row written as 0-28
-- becomes 1-28.
UPDATE `breed_lifecycle_stages`
SET `period_from` = 1
WHERE `feed_item_id` IS NOT NULL AND `period_from` = 0;
