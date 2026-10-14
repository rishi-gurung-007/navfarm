-- 14 Oct (Rishi): a Feed Consumption line removed from a stage is kept as a hidden history row, not deleted, so a
-- requisition or scheduler line that points at it keeps its stage label and its required-feed check. retired_at set =
-- hidden everywhere (inactive, not listed, not one of the stage's lines). Additive.
ALTER TABLE `breed_lifecycle_stages` ADD `retired_at` timestamp NULL;
