-- Gives the Semen Collector role (added empty by 0242) its starter grants, where the role has none yet; a company that
-- already edited the role in Roles is left as it is. Same list as modules/core/role/semen-collector-role.ts.
INSERT INTO `role_permissions` (`perm_id`, `role_id`, `module_code`, `resource`, `can_view`, `can_create`, `can_edit`, `can_delete`, `can_approve`, `can_export`, `can_print`)
SELECT UUID(), r.`role_id`, g.`module_code`, g.`resource`, g.`v`, g.`c`, g.`e`, 0, 0, g.`v`, g.`v`
FROM `role_master` r
JOIN (
  SELECT 'PIGGERY' AS `module_code`, 'ANIMAL' AS `resource`, 1 AS `v`, 1 AS `c`, 1 AS `e`
  UNION ALL SELECT 'MASTER_DATA', 'BREEDING_LINE_SETUP', 1, 0, 0
  UNION ALL SELECT 'MASTER_DATA', 'GENETIC_LEVEL_BAND', 1, 0, 0
  UNION ALL SELECT 'MASTER_DATA', 'BCS_SCALE', 1, 0, 0
  UNION ALL SELECT 'MASTER_DATA', 'BREED', 1, 0, 0
  UNION ALL SELECT 'MASTER_DATA', 'ITEM', 1, 0, 0
  UNION ALL SELECT 'MASTER_DATA', 'ITEM_CATEGORY', 1, 0, 0
  UNION ALL SELECT 'MASTER_DATA', 'ITEM_TYPE', 1, 0, 0
  UNION ALL SELECT 'MASTER_DATA', 'FARM', 1, 0, 0
  UNION ALL SELECT 'MASTER_DATA', 'LOCATION', 1, 0, 0
  UNION ALL SELECT 'MASTER_DATA', 'SHED', 1, 0, 0
  UNION ALL SELECT 'MASTER_DATA', 'SPECIES', 1, 0, 0
  UNION ALL SELECT 'MASTER_DATA', 'UOM', 1, 0, 0
  UNION ALL SELECT 'MASTER_DATA', 'WAREHOUSE', 1, 0, 0
  UNION ALL SELECT 'PRODUCTION', 'BATCH', 1, 0, 0
  UNION ALL SELECT 'INVENTORY', 'LEDGER', 1, 0, 0
  UNION ALL SELECT 'COMPANY', 'SETTINGS', 1, 0, 0
) AS g ON 1 = 1
WHERE r.`role_code` = 'SEMEN_COLLECTOR'
  AND NOT EXISTS (SELECT 1 FROM `role_permissions` p WHERE p.`role_id` = r.`role_id`);
