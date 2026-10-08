-- An animal is identified by its RFID tag alone (unique per tenant by
-- uq_animal_register_tenant_rfid). The Tattoo Number (ear_tag), the Serial
-- Number and the Landing Cost are retired; the opening asset value is the
-- acquisition cost.
ALTER TABLE `animal_register` DROP COLUMN `ear_tag`;
--> statement-breakpoint
ALTER TABLE `animal_register` DROP COLUMN `serial_number`;
--> statement-breakpoint
ALTER TABLE `animal_register` DROP COLUMN `landing_cost`;
