-- Master Setup r30/r38: effective-dated feed rows so a diet change can be planned ahead.
-- Nullable and additive; a row with no dates applies on every date, as before.
ALTER TABLE `breed_lifecycle_stages` ADD `effective_from` date;--> statement-breakpoint
ALTER TABLE `breed_lifecycle_stages` ADD `effective_to` date;
