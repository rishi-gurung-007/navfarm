-- 14 Oct (Rishi): an animal registered against a GRN leaves stock for the herd. The GRN posted Dr Inventory (1010) /
-- Cr Trade Payables (2010); registering moves the value on: Dr Biological Assets (1050) / Cr Inventory (1010).
-- BIO_ACQUISITION credits Trade Payables and would owe the supplier twice, so this is its own transaction type.
-- One mapping per company that has both accounts and none yet. Data only.
INSERT INTO `gl_mapping_master` (`mapping_id`, `tenant_id`, `company_id`, `transaction_type`, `debit_gl_account_id`, `credit_gl_account_id`)
SELECT UUID(), d.`tenant_id`, d.`company_id`, 'ANIMAL_REGISTRATION', MIN(d.`gl_account_id`), MIN(c.`gl_account_id`)
FROM `gl_account_master` d
JOIN `gl_account_master` c ON c.`tenant_id` = d.`tenant_id` AND c.`company_id` = d.`company_id` AND c.`account_code` = '1010' AND c.`deleted_at` IS NULL
WHERE d.`account_code` = '1050' AND d.`deleted_at` IS NULL AND d.`company_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `gl_mapping_master` m WHERE m.`company_id` = d.`company_id` AND m.`transaction_type` = 'ANIMAL_REGISTRATION' AND m.`deleted_at` IS NULL)
GROUP BY d.`tenant_id`, d.`company_id`;
