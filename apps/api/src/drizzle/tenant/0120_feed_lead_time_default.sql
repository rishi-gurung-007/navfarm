-- Spec D19 (Rishi, 26 Sep): Required On = Date to Refill - lead time, and the
-- lead time's default changes from 0 to 2 days. 0114 created the column with
-- DEFAULT 0 on 25 Sep; on nf_devco all 11 FARM rows still held that 0 on
-- 26 Sep, never edited. A deliberate 0 cannot be told from the old default,
-- so FARM rows still at 0 (or NULL) take the new default too — open question
-- Q11; a farm that really wants 0 re-enters it on the farm form.
ALTER TABLE `location_master` ALTER COLUMN `feed_lead_time_days` SET DEFAULT 2;
--> statement-breakpoint
UPDATE `location_master` SET `feed_lead_time_days` = 2
WHERE `location_type` = 'FARM' AND (`feed_lead_time_days` IS NULL OR `feed_lead_time_days` = 0);
