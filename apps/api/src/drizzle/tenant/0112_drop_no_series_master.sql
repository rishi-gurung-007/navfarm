-- Final step of the no_series_master -> no_series consolidation
-- (docs/decisions.md, 2026-09-23). Migration 0111 widened no_series to carry
-- everything no_series_master had; merge-no-series-master.ts backfilled every
-- row across; every code reference has moved onto no_series (confirmed by
-- grep — no_series_master appears nowhere outside schema.ts and comments).
-- No other table holds a live FK into no_series_master (confirmed live);
-- its own two FKs into nob_master/lob_master drop with it.
DROP TABLE `no_series_master`;
