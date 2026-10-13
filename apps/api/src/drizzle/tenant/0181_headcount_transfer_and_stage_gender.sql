-- Two additive columns, nothing existing is changed or backfilled.
--
-- batch_transfer.transfer_basis: ANIMALS (every transfer so far — one batch_transfer_line per registered animal) or
-- HEADCOUNT (a number of head moved between two batch-wise batches, which have no animal rows and so no lines).
-- Existing rows take ANIMALS from the default, which is what they are.
--
-- stage_master.applicable_gender: the sex a stage applies to — F, M, or NULL for either. NULL everywhere until a
-- stage is configured: which stages are sow-only or boar-only is the client's to say, so nothing is guessed here.
ALTER TABLE `batch_transfer` ADD COLUMN `transfer_basis` varchar(10) NOT NULL DEFAULT 'ANIMALS';
--> statement-breakpoint
ALTER TABLE `stage_master` ADD COLUMN `applicable_gender` char(1) DEFAULT NULL;
