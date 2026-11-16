-- 29 Oct 2026 (GL posting rules as setup): a G/L Mapping can name the Inventory Ledger entry type it applies to (POSITIVE, NEGATIVE, TRANSFER, OVERHEAD,
-- DESCRIPTIVE), as a sixth lookup dimension beside category, NOB, LOB, stage and valuation method. NULL means any entry type, so every existing mapping
-- keeps matching exactly what it matched before. Additive: one nullable column, nothing updated.
ALTER TABLE `gl_mapping_master` ADD `entry_type` varchar(20);
