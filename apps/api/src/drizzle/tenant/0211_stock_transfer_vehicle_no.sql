-- Preserve the vehicle/truck identity supplied during shipment so loading
-- instructions can group compartment lines by the actual truck.
ALTER TABLE `stock_transfer` ADD `vehicle_no` varchar(80);
