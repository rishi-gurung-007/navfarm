-- 15 Oct: update every dependent category, template and item row after 0201
-- renamed the item type code. The NOB/LOB LIVESTOCK code is unrelated.
--
UPDATE `item_category_master`
SET `item_type` = 'LIVING_ASSET'
WHERE `item_type` = 'LIVESTOCK';
--> statement-breakpoint

UPDATE `item_template`
SET `item_type` = 'LIVING_ASSET',
    `template_description` = CASE WHEN `template_description` = 'Livestock' THEN 'Living Asset' ELSE `template_description` END
WHERE `item_type` = 'LIVESTOCK';
--> statement-breakpoint

UPDATE `item_master`
SET `item_type` = 'LIVING_ASSET'
WHERE `item_type` = 'LIVESTOCK';
