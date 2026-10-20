-- 19 Oct 2026: a YEARLY/MONTHLY number series remembers the period it last issued in, so the reset no longer depends on
-- updated_at (which any edit of the series bumps, and so skipped the reset). Additive and nullable: a series that has never
-- recorded a period falls back to updated_at until its next number is issued.
ALTER TABLE `no_series` ADD `last_reset_period` varchar(10);
