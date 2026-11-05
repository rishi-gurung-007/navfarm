-- Route Stops drop the Zone and carry their own point (Rishi, 5 Nov): the route code already says which zone a
-- route runs in, so repeating it on every stop added nothing. A stop is now its own name and a map point, and the
-- distance from the previous stop is worked out from the two points rather than typed.
-- `zone_id` is relaxed to nullable rather than dropped, so stops already recorded against a zone keep it.
-- Numbered after Arun's unmerged 0238 on feat/system-schedulers so the two branches cannot share a number.
ALTER TABLE `logistics_route_stop` ADD `stop_name` varchar(120);--> statement-breakpoint
ALTER TABLE `logistics_route_stop` ADD `latitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `logistics_route_stop` ADD `longitude` decimal(10,7);--> statement-breakpoint
ALTER TABLE `logistics_route_stop` MODIFY `zone_id` varchar(36) NULL;
