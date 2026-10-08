-- One ledger entry can issue stock from several lots. The entry carries the whole quantity and its cost
-- (applications to the receipts it drew on); these lines say which lots (and serials) the stock physically
-- came out of. Lines are written with the entry and never edited: a reversal writes opposite lines.
-- A lot's stock is the sum of its inbound entries, its outbound entries that name it on the entry itself
-- (older and single-lot postings), and these lines.
CREATE TABLE IF NOT EXISTS `inventory_ledger_line` (
  `line_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36) NOT NULL,
  `ledger_id` varchar(36) NOT NULL,
  `line_no` int NOT NULL,
  `item_id` varchar(36) NOT NULL,
  `warehouse_id` varchar(36) DEFAULT NULL,
  `lot_no` varchar(50) DEFAULT NULL,
  `serial_no` text DEFAULT NULL,
  `quantity` decimal(18,4) NOT NULL,
  `expiry_date` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`line_id`),
  UNIQUE KEY `uq_inventory_ledger_line_no` (`ledger_id`, `line_no`),
  KEY `idx_inventory_ledger_line_lot` (`tenant_id`, `item_id`, `warehouse_id`, `lot_no`),
  CONSTRAINT `inv_ledger_line_ledger_fk` FOREIGN KEY (`ledger_id`) REFERENCES `inventory_ledger` (`ledger_id`) ON DELETE RESTRICT
);
