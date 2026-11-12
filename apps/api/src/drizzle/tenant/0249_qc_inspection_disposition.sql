-- 4 Nov 2026 (plan 2026-11-03-incoming-qc, "fix first" list): what becomes of a rejected quantity is now recorded on the inspection (returned to the supplier, scrapped, or held for a
-- decision) with a reference for the document that carries it out. Recording only: it posts nothing, because how a rejection is accounted for is Finance's decision. Additive; two
-- nullable columns, nothing updated.
-- 12 Nov 2026: written on 4 Nov as 0242 but never journalled, so it never ran (audit 10 Nov, C3) and 0242 was taken by collectors_are_users. Renumbered to 0249 and journalled.
ALTER TABLE `qc_inspection` ADD `rejection_disposition` varchar(25);
--> statement-breakpoint
ALTER TABLE `qc_inspection` ADD `rejection_ref` varchar(100);
