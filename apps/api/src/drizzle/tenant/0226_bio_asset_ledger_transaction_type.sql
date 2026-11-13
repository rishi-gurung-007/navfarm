-- 23 Oct 2026 (Bio Asset Ledger vocabulary): the ledger gets a stored Transaction Type, and both it and the Entry Type use only the lists the
-- Inventory Ledger uses. Entry Type: POSITIVE, NEGATIVE, TRANSFER, OVERHEAD, DESCRIPTIVE. Transaction Type: PURCHASE, CONSUMPTION, OUTPUT,
-- TRANSFER_SHIPMENT, TRANSFER_RECEIPT, SALES, VARIANCE_POSITIVE, VARIANCE_NEGATIVE (OVERHEAD / DESCRIPTIVE for cost-only and marker rows).
-- Several events now share one pair of codes, so the Document Type says which event a row is and is filled on every row.
--
-- Old entry type -> new codes (entry / transaction / document):
--   PURCHASE                       POSITIVE / PURCHASE / GOODS_RECEIPT
--   ACQUISITION with an animal     TRANSFER / TRANSFER_RECEIPT / ANIMAL_REGISTRATION
--   ACQUISITION of a batch         POSITIVE / OUTPUT if a farrowing made the batch, else PURCHASE / BATCH
--   CONSUMPTION                    OVERHEAD / CONSUMPTION / BATCH
--   OVERHEAD_COST, OVERHEAD, GROWTH_ADJMT   OVERHEAD / CONSUMPTION / BATCH_OVERHEAD
--   COST_ALLOCATION                TRANSFER / TRANSFER_SHIPMENT (the sow's side, negative) or TRANSFER_RECEIPT (the litter's) / its own document
--   TRANSFER_OUT, TRANSFER_IN      TRANSFER / TRANSFER_SHIPMENT, TRANSFER_RECEIPT / BATCH_TRANSFER
--   AMORTIZATION                   NEGATIVE / VARIANCE_NEGATIVE (POSITIVE / VARIANCE_POSITIVE for a reversal) / BIO_COSTING_RUN, or BATCH_AMORTIZATION
--   FAIR_VALUE_ADJMT               POSITIVE / VARIANCE_POSITIVE for a gain, NEGATIVE / VARIANCE_NEGATIVE for a loss / BIO_FAIR_VALUE_RUN, or BATCH_FAIR_VALUE
--   MORTALITY, WRITEOFF, DEAD_PLANT   NEGATIVE / VARIANCE_NEGATIVE / MORTALITY
--   TRANSFORMATION                 a gilt selection: TRANSFER / TRANSFER_SHIPMENT / GILT_SELECTION; the maturity marker: DESCRIPTIVE / DESCRIPTIVE / BATCH_MATURITY;
--                                  a sale: NEGATIVE / SALES; any other exit: NEGATIVE / CONSUMPTION; both under BATCH_DISPOSAL or ANIMAL_DISPOSAL
-- Each statement sets the transaction and document type before the entry type and reads only columns it does not change, because MySQL
-- evaluates the assignments of one UPDATE left to right. The old OVERHEAD (never written by the app) is converted first, since the
-- CONSUMPTION step creates rows whose new entry type is also OVERHEAD.
ALTER TABLE `bio_asset_ledger` ADD COLUMN `transaction_type` varchar(30);
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET `transaction_type` = 'CONSUMPTION', `document_type` = 'BATCH_OVERHEAD', `entry_type` = 'OVERHEAD'
WHERE `entry_type` IN ('OVERHEAD', 'GROWTH_ADJMT');
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET `transaction_type` = 'VARIANCE_NEGATIVE', `document_type` = 'MORTALITY', `entry_type` = 'NEGATIVE'
WHERE `entry_type` IN ('WRITEOFF', 'DEAD_PLANT');
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET `transaction_type` = 'PURCHASE', `document_type` = 'GOODS_RECEIPT', `entry_type` = 'POSITIVE'
WHERE `entry_type` = 'PURCHASE';
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET `transaction_type` = 'TRANSFER_RECEIPT', `document_type` = 'ANIMAL_REGISTRATION', `entry_type` = 'TRANSFER'
WHERE `entry_type` = 'ACQUISITION' AND `animal_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET
  `transaction_type` = IF(EXISTS (SELECT 1 FROM `farrowing_record` f WHERE f.`piglet_batch_id` = `bio_asset_ledger`.`batch_id`), 'OUTPUT', 'PURCHASE'),
  `document_type` = 'BATCH', `entry_type` = 'POSITIVE'
WHERE `entry_type` = 'ACQUISITION' AND `animal_id` IS NULL;
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET `transaction_type` = 'CONSUMPTION', `document_type` = 'BATCH', `entry_type` = 'OVERHEAD'
WHERE `entry_type` = 'CONSUMPTION';
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET `transaction_type` = 'CONSUMPTION', `document_type` = 'BATCH_OVERHEAD', `entry_type` = 'OVERHEAD'
WHERE `entry_type` = 'OVERHEAD_COST';
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET
  `transaction_type` = IF(`cost_amount` < 0, 'TRANSFER_SHIPMENT', 'TRANSFER_RECEIPT'),
  `document_type` = COALESCE(`document_type`, 'LITTER_BIRTH_COST'), `entry_type` = 'TRANSFER'
WHERE `entry_type` = 'COST_ALLOCATION';
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET `transaction_type` = 'TRANSFER_SHIPMENT', `document_type` = 'BATCH_TRANSFER', `entry_type` = 'TRANSFER'
WHERE `entry_type` = 'TRANSFER_OUT';
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET `transaction_type` = 'TRANSFER_RECEIPT', `document_type` = 'BATCH_TRANSFER', `entry_type` = 'TRANSFER'
WHERE `entry_type` = 'TRANSFER_IN';
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET
  `transaction_type` = IF(`cost_amount` > 0, 'VARIANCE_POSITIVE', 'VARIANCE_NEGATIVE'),
  `document_type` = IF(`run_id` IS NOT NULL, 'BIO_COSTING_RUN', 'BATCH_AMORTIZATION'),
  `entry_type` = IF(`cost_amount` > 0, 'POSITIVE', 'NEGATIVE')
WHERE `entry_type` = 'AMORTIZATION';
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET
  `transaction_type` = IF(`cost_amount` >= 0, 'VARIANCE_POSITIVE', 'VARIANCE_NEGATIVE'),
  `document_type` = IF(`run_id` IS NOT NULL, 'BIO_FAIR_VALUE_RUN', 'BATCH_FAIR_VALUE'),
  `entry_type` = IF(`cost_amount` >= 0, 'POSITIVE', 'NEGATIVE')
WHERE `entry_type` = 'FAIR_VALUE_ADJMT';
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET `transaction_type` = 'VARIANCE_NEGATIVE', `document_type` = 'MORTALITY', `entry_type` = 'NEGATIVE'
WHERE `entry_type` = 'MORTALITY';
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET `transaction_type` = 'TRANSFER_SHIPMENT', `document_type` = 'GILT_SELECTION', `entry_type` = 'TRANSFER'
WHERE `entry_type` = 'TRANSFORMATION' AND `document_type` = 'GILT_SELECTION';
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET `transaction_type` = 'DESCRIPTIVE', `document_type` = 'BATCH_MATURITY', `entry_type` = 'DESCRIPTIVE'
WHERE `entry_type` = 'TRANSFORMATION' AND `document_type` IS NULL AND `cost_amount` = 0 AND `quantity` > 0;
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET
  `transaction_type` = IF(`customer_id` IS NOT NULL, 'SALES', 'CONSUMPTION'),
  `document_type` = IF(`animal_id` IS NOT NULL, 'ANIMAL_DISPOSAL', 'BATCH_DISPOSAL'),
  `entry_type` = 'NEGATIVE'
WHERE `entry_type` = 'TRANSFORMATION';
--> statement-breakpoint
UPDATE `bio_asset_ledger` SET
  `transaction_type` = IF(`cost_amount` < 0, 'VARIANCE_NEGATIVE', 'VARIANCE_POSITIVE'),
  `document_type` = COALESCE(`document_type`, 'MANUAL_ENTRY'),
  `entry_type` = IF(`cost_amount` < 0, 'NEGATIVE', 'POSITIVE')
WHERE `transaction_type` IS NULL;
--> statement-breakpoint
ALTER TABLE `bio_asset_ledger` MODIFY `transaction_type` varchar(30) NOT NULL;
