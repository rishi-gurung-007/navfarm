-- The Semen Collector starter role is not a locked system role: a company opens it in Roles and adds the permissions its collectors need.
UPDATE `role_master` SET `is_system_role` = 0 WHERE `role_code` = 'SEMEN_COLLECTOR';
