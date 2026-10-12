-- Req r76 (11 Oct): the mill may enter an estimated arrival at dispatch. Nullable and additive.
ALTER TABLE `feed_loading_sheet` ADD `estimated_arrival_at` datetime;
