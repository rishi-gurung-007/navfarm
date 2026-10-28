-- 21 Oct 2026 (bio-asset costing): the residual value is set once for the company, per sex and from a date, instead of on every costing
-- profile. A change is a new row with a later effective_from, never an edit, so the figure each past run used can always be told.
-- An animal may carry her own residual (animal_register.residual_value, which already exists); the setting is the default. Additive: one table.
CREATE TABLE `bio_costing_residual_setting` (
  `setting_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `gender` char(1) NOT NULL,
  `residual_rule` varchar(20) NOT NULL DEFAULT 'NONE',
  `residual_fixed_amount` decimal(18,4),
  `residual_weight_kg` decimal(10,3),
  `residual_price_per_kg` decimal(18,6),
  `effective_from` date NOT NULL,
  `note` varchar(300),
  `created_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_id`),
  UNIQUE KEY `uq_bio_costing_residual_setting` (`company_id`, `gender`, `effective_from`),
  KEY `idx_bio_costing_residual_setting_tenant` (`tenant_id`, `company_id`),
  CONSTRAINT `fk_bio_costing_residual_company` FOREIGN KEY (`company_id`) REFERENCES `company_master` (`company_id`) ON DELETE RESTRICT
);
