-- D36 (Rishi, 28 Sep): the client documents give event-based stages a range —
-- FLUSH 3–5 days (BBP §1.7) — because the real change happens when the sow
-- shows heat or is served. The stage master's typical_duration_days is the
-- range's LATEST day, and FLUSH's is 5, not the 14 that Plan S's S7 ruling
-- set (superseded by D36). System (seeded) rows only, and only where the
-- duration is still 14: a tester's edited value is never overwritten, and a
-- stage already moved to another value is left alone. Nothing else changes.
UPDATE `stage_master`
SET `typical_duration_days` = 5
WHERE `is_system` = 1
  AND `stage_code` = 'FLUSH'
  AND `typical_duration_days` = 14
  AND `deleted_at` IS NULL;
