-- Found on the test server (Porta Farm): lifecycle rows created by 593d7c96's
-- gap carry company_id / nob_id / lob_id NULL, and enforceMasterRequest then
-- refuses them in a company or operational workspace ("Master record is not
-- available in this workspace"). This copies the breed's own scope onto rows
-- that have none. Nothing else: a row whose breed is a tenant template
-- (company_id NULL) stays as it is, and a row already carrying a scope is
-- never touched. No ids or names hard-coded; tenant-agnostic, so
-- db-migrate-all-tenants runs it per tenant DB unchanged.
UPDATE `breed_lifecycle_stages` l
JOIN `breed_master` b ON b.`breed_id` = l.`breed_id`
SET l.`company_id` = b.`company_id`,
    l.`nob_id` = b.`nob_id`,
    l.`lob_id` = b.`lob_id`
WHERE l.`company_id` IS NULL
  AND b.`company_id` IS NOT NULL;
