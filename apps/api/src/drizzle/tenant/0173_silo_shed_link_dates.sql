-- Master r8: a silo serves a shed from a date. Nullable and additive; no dates = always.
ALTER TABLE `silo_shed_link` ADD `effective_from` date;
--> statement-breakpoint
ALTER TABLE `silo_shed_link` ADD `effective_to` date;
