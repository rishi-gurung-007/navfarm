-- 4 Nov 2026 (NAVFarm_Dummy_COA.xlsx): the chart splits fair value into a gain account ("FV Gain - Weaners", 720100) and a loss account ("FV Loss -
-- Weaners", 820100). An item may now name a loss account of its own; a run posts a gain to bio_fv_gain_loss_gl_id and a loss here. Additive: one nullable
-- column, nothing updated; an item that names none posts its losses where it always has.
ALTER TABLE `item_master` ADD `bio_fv_loss_gl_id` varchar(36);
