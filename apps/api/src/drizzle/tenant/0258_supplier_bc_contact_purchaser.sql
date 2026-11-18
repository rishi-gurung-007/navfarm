-- 18 Nov 2026: the Vendor list shows BC's Contact and Purchaser Code (VendorlistApi: contactName, purchaserCode;
-- VendorCardApi: Control16 "Contact", Purchaser_Code). Both are copied by the vendor sync. Additive, nullable.
ALTER TABLE `supplier_master` ADD COLUMN `contact_name` varchar(100);
--> statement-breakpoint
ALTER TABLE `supplier_master` ADD COLUMN `purchaser_code` varchar(20);
