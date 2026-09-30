-- D42 (Rishi, 29 Sep): a parent is not always a registered animal — a purchased
-- or imported gilt arrives with its sire and dam named only on paper. These hold
-- what the papers say, beside the optional pickers for a parent that IS
-- registered. Available for every animal whatever its entry type.
ALTER TABLE `animal_register` ADD `sire_serial_no` varchar(100);--> statement-breakpoint
ALTER TABLE `animal_register` ADD `dam_serial_no` varchar(100);
