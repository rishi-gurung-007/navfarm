-- D1 (3 Oct, Task 9b): auto-draft 500'd on 7 of 9 demo farms. An ANIMAL_WISE/REGISTERED
-- batch's input id is `<batch_id>:<stage_id>` (feed-forecast.service.ts buildInputBatches,
-- 73 chars) — never a batch_header PK — and that composite was flowing straight into
-- requisition_line_batch.batch_id, a varchar(36) NOT NULL FK to batch_header.batch_id.
-- MySQL raised ER_DATA_TOO_LONG and rolled back the whole transaction; widening the column
-- would not have helped, since a composite is not a batch_header key at any width.
--
-- The fix (feed-forecast.engine.ts, feed-requisition.rules.ts) now carries the genuine
-- batch_id and the real stage_id as two separate values all the way to the writer, so
-- batch_id only ever receives a true batch_header PK. stage_id is additive (NULL for a
-- BATCH_WISE breakdown row, which has no stage group of its own).
--
-- The unique index widens to include stage_id: once batch_id is always the real PK, two
-- stage groups of the same batch feeding the same shed (an ANIMAL_WISE/REGISTERED batch
-- split by stage) would otherwise collide on (line_id, batch_id, shed_id) and the second
-- stage's breakdown row would be silently rejected or deduped. Rebuilding a unique index
-- is not a column drop (3 Oct constraint: additive only, no column drops).
--
-- MySQL refuses a bare "DROP INDEX uq_requisition_line_batch" here: that index's leftmost
-- column (line_id) is the only index supporting requisition_line_batch_line_id_fk, and
-- MySQL will not drop the sole index an existing foreign key depends on. The widened index
-- is therefore added first, under a temporary name, then the old one is dropped (now safe,
-- since the new index also covers line_id as its leftmost column), then renamed into the
-- name schema.ts declares. No window where the FK is unsupported.
ALTER TABLE `requisition_line_batch` ADD COLUMN `stage_id` varchar(36);--> statement-breakpoint
ALTER TABLE `requisition_line_batch` ADD CONSTRAINT `requisition_line_batch_stage_id_fk` FOREIGN KEY (`stage_id`) REFERENCES `stage_master`(`stage_id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `requisition_line_batch` ADD CONSTRAINT `uq_requisition_line_batch_v2` UNIQUE(`line_id`,`batch_id`,`stage_id`,`shed_id`);--> statement-breakpoint
ALTER TABLE `requisition_line_batch` DROP INDEX `uq_requisition_line_batch`;--> statement-breakpoint
ALTER TABLE `requisition_line_batch` RENAME INDEX `uq_requisition_line_batch_v2` TO `uq_requisition_line_batch`;
