-- Rishi, 30 Oct: beside the computed priority level (row 34) the farm types its
-- own order for each line, 1 first, so the mill can consolidate in that order.
-- Nullable: existing lines and lines drafted without one keep no number.
ALTER TABLE `requisition_line` ADD `priority_no` int;
