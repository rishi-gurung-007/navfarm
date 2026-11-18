-- Kill Sheet Integration Test: Multi-Company Topology Seed
-- Target: nf_killsheetita
-- Run with: mysql -u root nf_killsheetita < apps/api/src/scripts/seed-kill-sheet-it-topology.sql
--
-- What this does:
--   1. Inserts "Beta Company" as a second company in nf_killsheetita
--   2. Inserts "Beta Farm" under Beta Company
--   3. Inserts one batch for Alpha Company (Triple C Farm) → batch KS-ALPHA-001
--   4. Inserts one batch for Beta Company (Beta Farm)    → batch KS-BETA-001
--
-- For nf_killsheetitb, see the companion section at the bottom; run separately:
--   mysql -u root nf_killsheetitb < apps/api/src/scripts/seed-kill-sheet-itb-topology.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- Known IDs (confirmed from live DB, 2026-11-17)
-- Tenant A   : 324f7541-7bd2-420b-a006-b520e332235c
-- Company A  : bbb5c0a8-b08e-4af5-b063-4cf263b9aa73  (Triple C)
-- Farm A     : 2fecfce8-2edf-4271-b647-1f650f9ee60d  (Triple C Farm)
-- lob_id     : 60000000-6000-6000-6000-000000000007  (Piggery LOB)
-- nob_id     : 50000000-5000-5000-5000-000000000002  (Livestock NOB)
-- currency   : 20000000-2000-2000-2000-200000000002
-- language   : 10000000-1000-1000-1000-100000000001
-- timezone   : Africa/Harare
-- country    : ZWE
-- ─────────────────────────────────────────────────────────────────────────────

-- Generated UUIDs (stable, hardcoded for repeatability):
-- Company B  : c1be7420-b1b4-4c3d-8d2a-000000000001
-- Farm B     : f2ab9531-c2c5-4d4e-9e3b-000000000002
-- Batch A    : ba000000-0000-0000-0000-000000000001
-- Batch B    : bb000000-0000-0000-0000-000000000002

-- ── 1. Beta Company ───────────────────────────────────────────────────────────
INSERT IGNORE INTO company_master (
  company_id,
  tenant_id,
  company_code,
  company_name,
  company_display_name,
  company_type,
  industry_type,
  base_currency_id,
  default_language_id,
  default_timezone_id,
  country_id,
  financial_year_start,
  is_multi_farm,
  max_farm_locations,
  onboarding_status,
  is_active
) VALUES (
  'c1be7420-b1b4-4c3d-8d2a-000000000001',
  '324f7541-7bd2-420b-a006-b520e332235c',
  'BETACO',
  'Beta Company',
  'Beta Co',
  'PRIVATE',
  'LIVESTOCK',
  '20000000-2000-2000-2000-200000000002',
  '10000000-1000-1000-1000-100000000001',
  'Africa/Harare',
  'ZWE',
  4,
  0,
  1,
  'ACTIVE',
  1
);

-- ── 2. Beta Farm ──────────────────────────────────────────────────────────────
INSERT IGNORE INTO location_master (
  location_id,
  tenant_id,
  nob_id,
  lob_id,
  location_code,
  location_name,
  location_level,
  location_type,
  parent_location_id,
  company_id,
  is_active,
  status
) VALUES (
  'f2ab9531-c2c5-4d4e-9e3b-000000000002',
  '324f7541-7bd2-420b-a006-b520e332235c',
  '50000000-5000-5000-5000-000000000002',
  '60000000-6000-6000-6000-000000000007',
  'BETAFARM',
  'Beta Farm',
  1,
  'FARM',
  NULL,
  'c1be7420-b1b4-4c3d-8d2a-000000000001',
  1,
  'ACTIVE'
);

-- ── 3. Batch for Alpha Farm (Triple C Farm) ───────────────────────────────────
INSERT IGNORE INTO batch_header (
  batch_id,
  tenant_id,
  company_id,
  farm_id,
  batch_no,
  lob_id,
  nob_id,
  costing_method,
  uom,
  start_date,
  status,
  opening_quantity,
  animal_tracking,
  tracking_mode
) VALUES (
  'ba000000-0000-0000-0000-000000000001',
  '324f7541-7bd2-420b-a006-b520e332235c',
  'bbb5c0a8-b08e-4af5-b063-4cf263b9aa73',
  '2fecfce8-2edf-4271-b647-1f650f9ee60d',
  'KS-ALPHA-001',
  '60000000-6000-6000-6000-000000000007',
  '50000000-5000-5000-5000-000000000002',
  'STANDARD',
  'HEAD',
  '2026-01-01',
  'ACTIVE',
  200.0000,
  'COUNT_ONLY',
  'BATCH_WISE'
);

-- ── 4. Batch for Beta Farm ────────────────────────────────────────────────────
INSERT IGNORE INTO batch_header (
  batch_id,
  tenant_id,
  company_id,
  farm_id,
  batch_no,
  lob_id,
  nob_id,
  costing_method,
  uom,
  start_date,
  status,
  opening_quantity,
  animal_tracking,
  tracking_mode
) VALUES (
  'bb000000-0000-0000-0000-000000000002',
  '324f7541-7bd2-420b-a006-b520e332235c',
  'c1be7420-b1b4-4c3d-8d2a-000000000001',
  'f2ab9531-c2c5-4d4e-9e3b-000000000002',
  'KS-BETA-001',
  '60000000-6000-6000-6000-000000000007',
  '50000000-5000-5000-5000-000000000002',
  'STANDARD',
  'HEAD',
  '2026-01-01',
  'ACTIVE',
  200.0000,
  'COUNT_ONLY',
  'BATCH_WISE'
);
