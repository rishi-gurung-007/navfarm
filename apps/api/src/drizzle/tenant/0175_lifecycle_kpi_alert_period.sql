-- 12 Oct: Breed Lifecycle Stage gets a KPI alert period (Daily/Weekly/Monthly), stored only. Additive.
ALTER TABLE `breed_lifecycle_stages` ADD COLUMN `kpi_alert_period` varchar(10) NULL;
