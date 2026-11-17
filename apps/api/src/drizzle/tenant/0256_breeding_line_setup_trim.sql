-- 16 Nov 2026: Breeding Line Setup keeps only what the client's documents ask for (the Breeding Boars FRS and SOP 21).
-- Removed, with the rules that read them:
--   * the colorant stock item and quantity per lot: the colorant is recorded on the lot by name only, nothing is issued
--     from stock or costed (so the lot's colorant item, quantity and cost go too);
--   * the minimum rest days, the motility floor and the warn/stop choice for them: no figure was given;
--   * the dose-rank weight: the client's sheets grade on the genetic and morphology ranks only;
--   * the body condition days of grace and of notice: a boar is due on his due date and overdue after it.
-- Every one of these columns was empty (NULL, or the default WARN) on nf_devco, nf_system and nf_tieproof_before when
-- this was written, so no recorded value is lost.
ALTER TABLE `breeding_line_setup` DROP FOREIGN KEY `breeding_line_setup_colorant_item_id_item_master_item_id_fk`;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` DROP COLUMN `colorant_item_id`;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` DROP COLUMN `colorant_qty_per_lot`;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` DROP COLUMN `min_rest_days`;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` DROP COLUMN `min_motility_pct`;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` DROP COLUMN `rule_enforcement`;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` DROP COLUMN `grading_dose_weight`;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` DROP COLUMN `bcs_grace_days`;
--> statement-breakpoint
ALTER TABLE `breeding_line_setup` DROP COLUMN `bcs_reminder_days`;
--> statement-breakpoint
ALTER TABLE `semen_batch` DROP COLUMN `colorant_item_id`;
--> statement-breakpoint
ALTER TABLE `semen_batch` DROP COLUMN `colorant_qty`;
--> statement-breakpoint
ALTER TABLE `semen_batch` DROP COLUMN `colorant_cost`;
