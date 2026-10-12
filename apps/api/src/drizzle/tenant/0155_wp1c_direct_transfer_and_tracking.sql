-- WP1c (Rishi's 4 Oct list, common-requisition-spec.md), additive only.
-- 1) The Direct Transfer right lives in User Setup (user_master) — the ONE
--    source the requisition's create/update reads; previously the checkbox
--    was ungated.
-- 2) The requisition line's Item Tracking assignment (lot/serial) — mandatory
--    before shipment for a tracked item, flowed onto the linked transfer's
--    lines at release, copied to the receipt by the transfer's own rules.
-- 0146 is reserved for the deferred feed-era drop and MUST be journalled with
-- a `when` greater than this file's (drizzle applies by `when`, not idx).
ALTER TABLE `user_master` ADD `direct_transfer_allowed` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `lot_no` varchar(50);--> statement-breakpoint
ALTER TABLE `requisition_line` ADD `serial_no` varchar(100);
