-- Pooled semen: one lot mixed from the ejaculates of several boars. `semen_batch.boar_animal_id` stays the primary
-- boar (the first one chosen, and the one the lot's QR and batch are tied to); a lot that was pooled also has one row
-- here per boar that went into it, with the share of the lot's running cost that boar carried. A lot from one boar has
-- no rows here, so every lot recorded before this reads exactly as it did. Additive.
CREATE TABLE IF NOT EXISTS `semen_batch_boar` (
  `semen_batch_id` varchar(36) NOT NULL,
  `boar_animal_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `boar_batch_id` varchar(36) NULL DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT 0,
  `cost_share` decimal(18,4) NOT NULL DEFAULT 0.0000,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`semen_batch_id`, `boar_animal_id`),
  KEY `idx_semen_batch_boar_boar` (`boar_animal_id`),
  CONSTRAINT `fk_semen_batch_boar_lot` FOREIGN KEY (`semen_batch_id`) REFERENCES `semen_batch` (`semen_batch_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_semen_batch_boar_boar` FOREIGN KEY (`boar_animal_id`) REFERENCES `animal_register` (`animal_id`) ON DELETE RESTRICT
);
--> statement-breakpoint
-- The boars an entered semen collection is pooled with, kept on the draft so posting the day uses them (a JSON array of
-- animal ids; the boar the row is entered against is the primary and is not repeated). Null on every other row.
ALTER TABLE `batch_daily_data` ADD COLUMN `pool_animal_ids` text NULL DEFAULT NULL;
