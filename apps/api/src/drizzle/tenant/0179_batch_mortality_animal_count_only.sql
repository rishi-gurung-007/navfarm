-- 12 Oct: a count-only batch (no registered animals) still records each death's dead weight and reason, with no animal to name. Additive: relaxes NOT NULL only.
ALTER TABLE `batch_mortality_animal` MODIFY `animal_id` varchar(36) NULL;
