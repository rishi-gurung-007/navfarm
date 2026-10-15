-- 15 Oct (Rishi): the item type shown as "Livestock" is now "Living Asset".
--
-- The item type code is stored in item_type_master and repeated on item rows;
-- migration 0202 updates those references after this master row.
--
-- This does NOT touch nob_master: "Livestock" is also the line-of-business above Piggery, and that keeps its name.
UPDATE `item_type_master`
SET `type_code` = 'LIVING_ASSET',
    `type_name` = 'Living Asset',
    `code_prefix` = 'LIVING_ASSET',
    `description` = 'Living biological asset (animal). Not stock — it is carried in the Assets Ledger.'
WHERE `type_code` = 'LIVESTOCK';
