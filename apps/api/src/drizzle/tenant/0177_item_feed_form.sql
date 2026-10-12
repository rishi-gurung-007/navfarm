-- 12 Oct: an item of a feed type states whether it is Bulk or Bagged. Additive.
ALTER TABLE `item_master` ADD COLUMN `feed_form` varchar(10) NULL;
