-- 13 Oct (Rishi): "Centre" everywhere. The seeded Cost Centre number series was named "Cost Center Code (typed, not
-- generated)"; new tenants now get "Cost Centre ...", this renames the rows existing tenants already have. Text only, idempotent.
UPDATE `no_series` SET `description` = REPLACE(`description`, 'Cost Center', 'Cost Centre') WHERE `description` LIKE '%Cost Center%';
