-- 13 Oct (Rishi): the backend key is a UUID; the readable APP code is for the screens and follows the company's
-- ITEM_APPLICATION number series. Each company has its own series, so two companies in one tenant both issue APP-00001:
-- as the primary key that collided. The code moves to its own column, unique per company. Existing rows keep their id
-- and copy it as their code. Additive.
ALTER TABLE `inventory_application` ADD `application_no` varchar(50);
--> statement-breakpoint
UPDATE `inventory_application` SET `application_no` = `application_id` WHERE `application_no` IS NULL;
--> statement-breakpoint
ALTER TABLE `inventory_application` ADD CONSTRAINT `uq_inv_app_company_no` UNIQUE (`company_id`, `application_no`);
