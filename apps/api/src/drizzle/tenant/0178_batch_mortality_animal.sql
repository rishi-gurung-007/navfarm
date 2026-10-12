-- 12 Oct: which registered animals died on a Data Entry mortality line, how much the dead body weighed and why. Additive.
CREATE TABLE `batch_mortality_animal` (
  `detail_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `batch_id` varchar(36) NOT NULL,
  `line_id` varchar(36) NOT NULL,
  `entry_date` date NOT NULL,
  `animal_id` varchar(36) NOT NULL,
  `dead_weight_kg` decimal(10,3) NOT NULL,
  `reason_id` varchar(36),
  `reason_text` varchar(200),
  `posted` boolean NOT NULL DEFAULT false,
  `created_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`detail_id`),
  UNIQUE KEY `uq_bma_line_date_animal` (`line_id`,`entry_date`,`animal_id`),
  KEY `idx_bma_batch_date` (`batch_id`,`entry_date`),
  CONSTRAINT `bma_batch_fk` FOREIGN KEY (`batch_id`) REFERENCES `batch_header` (`batch_id`) ON DELETE RESTRICT,
  CONSTRAINT `bma_animal_fk` FOREIGN KEY (`animal_id`) REFERENCES `animal_register` (`animal_id`) ON DELETE RESTRICT,
  CONSTRAINT `bma_reason_fk` FOREIGN KEY (`reason_id`) REFERENCES `reason_master` (`reason_id`) ON DELETE RESTRICT
);
