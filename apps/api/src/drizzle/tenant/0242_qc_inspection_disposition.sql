-- 4 Nov 2026 (plan 2026-11-03-incoming-qc, "fix first" list): what becomes of a rejected quantity is now recorded on the inspection (returned to the supplier, scrapped, or held for a
-- decision) with a reference for the document that carries it out. Recording only: it posts nothing, because how a rejection is accounted for is Finance's decision. Additive; two
-- nullable columns, nothing updated.
ALTER TABLE `qc_inspection` ADD `rejection_disposition` varchar(25);
--> statement-breakpoint
ALTER TABLE `qc_inspection` ADD `rejection_ref` varchar(100);
