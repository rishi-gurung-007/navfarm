-- 11 Oct: Production Slots removed (not in the client workbook). A BIN carries one diet per production date,
-- enforced by the service. The legacy slot column becomes optional so new assignments carry no slot.
-- Additive relaxation only: no table, column or index is dropped.
ALTER TABLE `bin_diet_assignment` MODIFY COLUMN `production_slot_id` varchar(36) NULL;
