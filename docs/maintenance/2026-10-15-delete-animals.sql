-- ============================================================================
-- Delete four animals from nf_portatestnavfarm (15 Oct).
--
-- animal_register has 16 incoming foreign keys. Five are ON DELETE SET NULL and
-- clear themselves (batch_daily_data, batch_transaction, milk_production_log,
-- and the sire/dam self-references). Eleven are ON DELETE RESTRICT and must be
-- cleared by hand first — that is what the DELETEs below do, in dependency
-- order. Second level is harmless: farrowing_record.breeding_id is SET NULL,
-- and semen_batch_boar CASCADEs from semen_batch.
--
-- Run STEP 1 first and read it. Only then run STEP 2.
-- ============================================================================
USE nf_portatestnavfarm;

-- --- STEP 1 ------------------------------------------------------ read-only --
-- What would be destroyed along with the animals. DLNA8228 is LACTATING, so
-- expect farrowing and breeding rows against her.
SELECT 'bio_asset_ledger'       AS t, COUNT(*) AS n FROM bio_asset_ledger       WHERE animal_id      IN (SELECT animal_id FROM animal_register WHERE animal_code IN ('P25003','P26302','P2975','DLNA8228'))
UNION ALL SELECT 'animal_movement_log',    COUNT(*) FROM animal_movement_log    WHERE animal_id      IN (SELECT animal_id FROM animal_register WHERE animal_code IN ('P25003','P26302','P2975','DLNA8228'))
UNION ALL SELECT 'animal_medication_log',  COUNT(*) FROM animal_medication_log  WHERE animal_id      IN (SELECT animal_id FROM animal_register WHERE animal_code IN ('P25003','P26302','P2975','DLNA8228'))
UNION ALL SELECT 'farrowing_record',       COUNT(*) FROM farrowing_record       WHERE sow_animal_id  IN (SELECT animal_id FROM animal_register WHERE animal_code IN ('P25003','P26302','P2975','DLNA8228'))
UNION ALL SELECT 'breeding_record',        COUNT(*) FROM breeding_record        WHERE sow_animal_id  IN (SELECT animal_id FROM animal_register WHERE animal_code IN ('P25003','P26302','P2975','DLNA8228'))
                                                                                   OR boar_animal_id IN (SELECT animal_id FROM animal_register WHERE animal_code IN ('P25003','P26302','P2975','DLNA8228'))
UNION ALL SELECT 'farm_record_animal',     COUNT(*) FROM farm_record_animal     WHERE animal_id      IN (SELECT animal_id FROM animal_register WHERE animal_code IN ('P25003','P26302','P2975','DLNA8228'))
UNION ALL SELECT 'batch_mortality_animal', COUNT(*) FROM batch_mortality_animal WHERE animal_id      IN (SELECT animal_id FROM animal_register WHERE animal_code IN ('P25003','P26302','P2975','DLNA8228'))
UNION ALL SELECT 'batch_transfer_line',    COUNT(*) FROM batch_transfer_line    WHERE animal_id      IN (SELECT animal_id FROM animal_register WHERE animal_code IN ('P25003','P26302','P2975','DLNA8228'));

-- --- STEP 2 --------------------------------------------------------- writes --
START TRANSACTION;

DROP TEMPORARY TABLE IF EXISTS _doomed;
CREATE TEMPORARY TABLE _doomed AS
  SELECT animal_id FROM animal_register
  WHERE animal_code IN ('P25003','P26302','P2975','DLNA8228');

DELETE FROM farrowing_record       WHERE sow_animal_id  IN (SELECT animal_id FROM _doomed);
DELETE FROM breeding_record        WHERE sow_animal_id  IN (SELECT animal_id FROM _doomed)
                                      OR boar_animal_id IN (SELECT animal_id FROM _doomed);
DELETE FROM semen_batch_boar       WHERE boar_animal_id IN (SELECT animal_id FROM _doomed);
DELETE FROM semen_batch            WHERE boar_animal_id IN (SELECT animal_id FROM _doomed);
DELETE FROM animal_medication_log  WHERE animal_id      IN (SELECT animal_id FROM _doomed);
DELETE FROM animal_movement_log    WHERE animal_id      IN (SELECT animal_id FROM _doomed);
DELETE FROM batch_mortality_animal WHERE animal_id      IN (SELECT animal_id FROM _doomed);
DELETE FROM batch_transfer_line    WHERE animal_id      IN (SELECT animal_id FROM _doomed);
DELETE FROM farm_record_animal     WHERE animal_id      IN (SELECT animal_id FROM _doomed);
DELETE FROM bio_asset_ledger       WHERE animal_id      IN (SELECT animal_id FROM _doomed);

DELETE FROM animal_register WHERE animal_id IN (SELECT animal_id FROM _doomed);

SELECT COUNT(*) AS should_be_zero FROM animal_register
WHERE animal_code IN ('P25003','P26302','P2975','DLNA8228');

COMMIT;   -- or ROLLBACK; if the count above is not 0
DROP TEMPORARY TABLE IF EXISTS _doomed;

-- --- Afterwards --------------------------------------------------------------
-- The GL keeps their postings: journal_header links by source_document_type /
-- source_document_no and has no foreign key to animal_register, so the
-- ANIMAL_REGISTRATION entries survive and your balances still include them.
--   SELECT journal_no, posting_date, source_document_no, description, total_debit
--   FROM journal_header WHERE source_document_type = 'ANIMAL_REGISTRATION';
--
-- Note this is not what the app does. The Dispose action is the supported way
-- to take an animal out of the herd: it sets the status, dates and disposal
-- value and posts the matching accounting, instead of erasing the history.
-- A hard delete is fine on a throwaway test database, not on nf_ppl.
