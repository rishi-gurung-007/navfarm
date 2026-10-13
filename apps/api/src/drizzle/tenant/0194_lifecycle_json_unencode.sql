-- 13 Oct: breed lifecycle stages saved from the form stored their JSON lists as an encoded string (the service
-- JSON.stringify'd a value the json column serialises again), and in the built API every KPI line was emptied to []
-- (class-transformer bundled twice). The KPI evaluator reads only arrays, so those stages raised no KPI alerts.
-- 1) A list stored as an encoded string becomes the JSON it encodes. 2) KPI lists whose lines were emptied ([[]],
-- [[],[]] ...) hold nothing recoverable and are cleared; re-enter those KPIs. Data only, idempotent.
UPDATE `breed_lifecycle_stages` SET `kpi_thresholds` = CAST(JSON_UNQUOTE(`kpi_thresholds`) AS JSON) WHERE JSON_TYPE(`kpi_thresholds`) = 'STRING' AND JSON_VALID(JSON_UNQUOTE(`kpi_thresholds`));
--> statement-breakpoint
UPDATE `breed_lifecycle_stages` SET `vaccination_protocol` = CAST(JSON_UNQUOTE(`vaccination_protocol`) AS JSON) WHERE JSON_TYPE(`vaccination_protocol`) = 'STRING' AND JSON_VALID(JSON_UNQUOTE(`vaccination_protocol`));
--> statement-breakpoint
UPDATE `breed_lifecycle_stages` SET `medication_protocol` = CAST(JSON_UNQUOTE(`medication_protocol`) AS JSON) WHERE JSON_TYPE(`medication_protocol`) = 'STRING' AND JSON_VALID(JSON_UNQUOTE(`medication_protocol`));
--> statement-breakpoint
UPDATE `breed_lifecycle_stages` SET `resource_requirements` = CAST(JSON_UNQUOTE(`resource_requirements`) AS JSON) WHERE JSON_TYPE(`resource_requirements`) = 'STRING' AND JSON_VALID(JSON_UNQUOTE(`resource_requirements`));
--> statement-breakpoint
UPDATE `breed_lifecycle_stages` SET `kpi_thresholds` = NULL WHERE JSON_TYPE(`kpi_thresholds`) = 'ARRAY' AND JSON_LENGTH(`kpi_thresholds`) > 0 AND JSON_TYPE(JSON_EXTRACT(`kpi_thresholds`, '$[0]')) = 'ARRAY';
