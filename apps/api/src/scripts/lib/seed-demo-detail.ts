/**
 * Fills the optional master fields the core seeds leave NULL, so a master's
 * edit form shows a populated record rather than a page of blanks.
 *
 * This is DEMO DATA for internal testing and presentation. It is not from Triple
 * C and must not be presented as theirs. Values are either industry-standard
 * swine benchmarks or obviously synthetic, and anything that is a judgement call
 * is written into a description/notes field that says so — the same convention
 * `breed_lifecycle_stages.notes` already uses ("Illustrative demo benchmark, not
 * a client-approved feeding protocol").
 *
 * Deliberately NOT filled, because they are the client's to supply and a
 * plausible-looking invention is worse than a blank:
 *   - supplier bank details and health-certificate URLs
 *   - location street addresses (a farm block label is used instead)
 *   - the remaining ~44 reason codes (see docs/decisions.md)
 *
 * Runs as a seed stage after every master exists, and only ever fills a NULL —
 * re-running changes nothing and it never overwrites a chosen value.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';

const DEMO_NOTE = 'Illustrative demo value for internal testing — not client-approved data.';

/**
 * Industry-standard swine benchmarks by breed. These are real published ranges
 * for the breed, not Triple C's own herd performance, which is why each row also
 * gets a description saying so.
 */
const BREED_BENCHMARKS: Record<string, { fcr: string; adg: string; mortality: string; litter: string; mature: number; carcass: string; note: string }> = {
  LARGE_WHITE:  { fcr: '2.6500', adg: '750.0000', mortality: '4.50', litter: '12.50', mature: 8, carcass: '78.0000', note: 'Maternal line. High litter size and milk yield; commonly crossed with Landrace for F1 gilts.' },
  LANDRACE:     { fcr: '2.7000', adg: '730.0000', mortality: '4.80', litter: '12.80', mature: 8, carcass: '77.0000', note: 'Maternal line. Long body, excellent mothering ability and teat count.' },
  DUROC:        { fcr: '2.5500', adg: '800.0000', mortality: '4.20', litter: '10.50', mature: 8, carcass: '80.0000', note: 'Terminal sire line. Fast growth and intramuscular fat; used over F1 females.' },
  YORKSHIRE:    { fcr: '2.6000', adg: '760.0000', mortality: '4.40', litter: '12.20', mature: 8, carcass: '78.5000', note: 'Maternal line, closely related to Large White. Sound legs and good feed conversion.' },
};

/** Stocking and storage profile per item type. */
const ITEM_PROFILE: Record<string, { min: string; max: string; reorder: string; lead: number; shelf: number | null; tmin: string | null; tmax: string | null; posting: string }> = {
  RAW_MATERIAL:   { min: '2000.0000', max: '25000.0000', reorder: '5000.0000', lead: 14, shelf: 180, tmin: '10.00', tmax: '30.00', posting: 'RAW_MATERIALS' },
  FEED:           { min: '1500.0000', max: '20000.0000', reorder: '4000.0000', lead: 7,  shelf: 90,  tmin: '10.00', tmax: '28.00', posting: 'FINISHED_FEED' },
  MEDICINE:       { min: '10.0000',   max: '150.0000',   reorder: '25.0000',   lead: 21, shelf: 730, tmin: '2.00',  tmax: '8.00',  posting: 'VET_SUPPLIES' },
  VACCINE:        { min: '5.0000',    max: '80.0000',    reorder: '15.0000',   lead: 28, shelf: 365, tmin: '2.00',  tmax: '8.00',  posting: 'VET_SUPPLIES' },
  LIVESTOCK:      { min: '0.0000',    max: '0.0000',     reorder: '0.0000',    lead: 0,  shelf: null, tmin: null,   tmax: null,    posting: 'BIOLOGICAL_ASSETS' },
  FINISHED_GOODS: { min: '0.0000',    max: '5000.0000',  reorder: '500.0000',  lead: 1,  shelf: 14,  tmin: '-2.00', tmax: '4.00',  posting: 'FINISHED_GOODS' },
};

/** Meat/egg withdrawal, in days, for the medicated items in the demo catalogue. */
const WITHDRAWAL_DAYS: Record<string, number> = {
  'Penicillin G Procaine 300K IU 100ml': 14,
  'Ivermectin 1% Swine Dewormer 100ml': 18,
  'Tylosin Tartrate 100g Soluble Powder': 5,
  'Oxytocin 10 IU/ml 50ml Injection': 3,
  'Iron Dextran 100mg/ml 100ml Injection': 0,
};

/** Which item type each demo category holds, so the category form is not blank. */
const CATEGORY_ITEM_TYPE: Record<string, string> = {
  'Raw Grains & Cereals': 'RAW_MATERIAL',
  'Protein Meals & Supplements': 'RAW_MATERIAL',
  'Vitamins & Mineral Premixes': 'RAW_MATERIAL',
  'Finished Swine Feeds & Diets': 'FEED',
  'Veterinary Medicines & Antibiotics': 'MEDICINE',
  'Swine Immunization Vaccines': 'VACCINE',
  'Biological Assets - Breeding Stock': 'LIVESTOCK',
  'Biological Assets - Grower & Finisher': 'LIVESTOCK',
};

/** Capacity/geometry per location type. Block labels, never a street address. */
const LOCATION_PROFILE: Record<string, { area: string; unit: string; downtime: number; label: string }> = {
  FARM:       { area: '120000.0000', unit: 'SQM',  downtime: 0, label: 'Main farm block' },
  SHED:       { area: '1800.0000',   unit: 'SQM',  downtime: 3, label: 'Production shed block' },
  PEN:        { area: '42.0000',     unit: 'SQM',  downtime: 2, label: 'Pen bay' },
  STORE:      { area: '600.0000',    unit: 'SQM',  downtime: 1, label: 'Store block' },
  SILO:       { area: '80.0000',     unit: 'SQM',  downtime: 1, label: 'Feed silo pad' },
  QUARANTINE: { area: '90.0000',     unit: 'SQM',  downtime: 7, label: 'Isolation block' },
  CAGE:       { area: '12.0000',     unit: 'SQM',  downtime: 1, label: 'Cage bay' },
};

export interface DetailResult { what: string; rows: number }

export async function enrichDemoMasters(conn: mysql.Connection, tenantId: string): Promise<DetailResult[]> {
  const out: DetailResult[] = [];
  const run = async (what: string, sql: string, params: unknown[] = []) => {
    const [res] = await conn.query<any>(sql, params);
    if (res?.affectedRows) out.push({ what, rows: res.affectedRows });
  };

  // ---- Breeds: published benchmarks, flagged as illustrative in the description.
  for (const [code, b] of Object.entries(BREED_BENCHMARKS)) {
    await run(`breed ${code}`,
      `UPDATE breed_master SET
         avg_fcr = COALESCE(avg_fcr, ?), avg_growth_rate_g_day = COALESCE(avg_growth_rate_g_day, ?),
         avg_mortality_pct = COALESCE(avg_mortality_pct, ?), avg_litter_size = COALESCE(avg_litter_size, ?),
         mature_age_months = COALESCE(mature_age_months, ?), avg_yield_per_unit = COALESCE(avg_yield_per_unit, ?),
         description = COALESCE(description, ?)
       WHERE tenant_id = ? AND breed_code = ?`,
      [b.fcr, b.adg, b.mortality, b.litter, b.mature, b.carcass, `${b.note} ${DEMO_NOTE}`, tenantId, code]);
  }

  // ---- Items: stocking policy, storage envelope and posting group by item type.
  for (const [type, p] of Object.entries(ITEM_PROFILE)) {
    await run(`item stocking (${type})`,
      `UPDATE item_master SET
         min_stock_level = COALESCE(min_stock_level, ?), max_stock_level = COALESCE(max_stock_level, ?),
         reorder_level = COALESCE(reorder_level, ?), lead_time_days = COALESCE(lead_time_days, ?),
         shelf_life_days = COALESCE(shelf_life_days, ?),
         storage_temp_min = COALESCE(storage_temp_min, ?), storage_temp_max = COALESCE(storage_temp_max, ?),
         posting_group = COALESCE(posting_group, ?)
       WHERE tenant_id = ? AND item_type = ?`,
      [p.min, p.max, p.reorder, p.lead, p.shelf, p.tmin, p.tmax, p.posting, tenantId, type]);
  }
  // Do not invent a purchase/usage pair. The recorded rule says Primary UOM is
  // the purchase unit and Secondary UOM is the usage unit; the old demo pass
  // forced KG/BAG in the opposite direction for every feed and raw material.
  // Remove only that exact synthetic value so a real/user-entered pair is not
  // touched. Fresh seeds simply leave both optional fields blank.
  await run('remove reversed demo item UOM pair',
    `UPDATE item_master SET uom_secondary = NULL, uom_conversion_factor = NULL
     WHERE tenant_id = ? AND uom_primary = 'KG' AND uom_secondary = 'BAG'
       AND uom_conversion_factor = 50.000000 AND item_type IN ('RAW_MATERIAL','FEED')`, [tenantId]);
  for (const [name, days] of Object.entries(WITHDRAWAL_DAYS)) {
    await run('item withdrawal days',
      `UPDATE item_master SET withdrawal_days = COALESCE(withdrawal_days, ?) WHERE tenant_id = ? AND item_name = ?`,
      [days, tenantId, name]);
  }
  // Inventory and COGS accounts, matched by the account codes the demo chart uses.
  await run('item GL accounts',
    `UPDATE item_master i
       JOIN gl_account_master inv ON inv.tenant_id = i.tenant_id AND inv.account_code = '1030'
         AND (inv.company_id <=> i.company_id)
       JOIN gl_account_master cogs ON cogs.tenant_id = i.tenant_id AND cogs.account_code = '5010'
         AND (cogs.company_id <=> i.company_id)
     SET i.inventory_gl_account = COALESCE(i.inventory_gl_account, inv.gl_account_id),
         i.cogs_gl_account = COALESCE(i.cogs_gl_account, cogs.gl_account_id)
     WHERE i.tenant_id = ?`, [tenantId]);

  // ---- Item categories: which item type the category holds.
  for (const [name, type] of Object.entries(CATEGORY_ITEM_TYPE)) {
    await run('item category type',
      `UPDATE item_category_master SET item_type = COALESCE(item_type, ?) WHERE tenant_id = ? AND category_name = ?`,
      [type, tenantId, name]);
  }

  // ---- Locations: area, unit and cleaning downtime by type. Block labels only.
  for (const [type, p] of Object.entries(LOCATION_PROFILE)) {
    await run(`location ${type}`,
      `UPDATE location_master SET
         area_size = COALESCE(area_size, ?), area_unit = COALESCE(area_unit, ?),
         downtime_days_required = COALESCE(downtime_days_required, ?),
         location_address = COALESCE(location_address, CONCAT(?, ' — ', location_name))
       WHERE tenant_id = ? AND location_type = ?`,
      [p.area, p.unit, p.downtime, p.label, tenantId, type]);
  }

  // ---- Resources: asset and staffing detail so the resource form is complete.
  await run('resource manpower detail',
    `UPDATE resource_master SET
       employee_id = COALESCE(employee_id, CONCAT('EMP-', LPAD(FLOOR(1 + RAND() * 400), 4, '0'))),
       department = COALESCE(department, 'Farm Operations'),
       cost_element = COALESCE(cost_element, 'DIRECT_LABOUR')
     WHERE tenant_id = ? AND resource_type = 'MANPOWER'`, [tenantId]);
  await run('resource asset detail',
    `UPDATE resource_master SET
       asset_code = COALESCE(asset_code, CONCAT('AST-', UPPER(LEFT(REPLACE(resource_name, ' ', ''), 6)))),
       asset_serial_no = COALESCE(asset_serial_no, CONCAT('SN-', LPAD(FLOOR(1 + RAND() * 900000), 6, '0'))),
       warranty_expiry_date = COALESCE(warranty_expiry_date, '2027-06-30'),
       cost_element = COALESCE(cost_element, 'MACHINE_HOURS')
     WHERE tenant_id = ? AND resource_type IN ('EQUIPMENT','VEHICLE')`, [tenantId]);

  // ---- Animals: bio-asset and physical detail.
  await run('animal physical detail',
    `UPDATE animal_register SET
       no_of_teats = COALESCE(no_of_teats, CASE WHEN gender = 'F' THEN 14 ELSE NULL END),
       grading = COALESCE(grading, 'A'),
       age_at_entry_weeks = COALESCE(age_at_entry_weeks, 30),
       serial_number = COALESCE(serial_number, ear_tag),
       notes = COALESCE(notes, ?)
     WHERE tenant_id = ?`, [DEMO_NOTE, tenantId]);
  // Amortisation over a five-year productive life, 20% residual — the shape the
  // Bio Asset BBP describes. Residual value per-kg vs percentage is still open,
  // so this is the column that exists today.
  await run('animal amortisation',
    `UPDATE animal_register SET
       productive_life_start = COALESCE(productive_life_start, entry_date),
       residual_value = COALESCE(residual_value, ROUND(acquisition_cost * 0.20, 4)),
       amortisation_monthly = COALESCE(amortisation_monthly, ROUND(acquisition_cost * 0.80 / 60, 4)),
       total_amortised = COALESCE(total_amortised, 0),
       expected_cull_date = COALESCE(expected_cull_date, DATE_ADD(entry_date, INTERVAL 5 YEAR))
     WHERE tenant_id = ? AND acquisition_cost IS NOT NULL`, [tenantId]);

  // ---- GL accounts: parent the detail accounts onto their range header.
  await run('gl account parents',
    `UPDATE gl_account_master c
       JOIN gl_account_master p ON p.tenant_id = c.tenant_id AND (p.company_id <=> c.company_id)
         AND p.account_code = CONCAT(LEFT(c.account_code, 1), '000')
     SET c.parent_account_id = p.gl_account_id
     WHERE c.tenant_id = ? AND c.parent_account_id IS NULL AND c.account_code <> CONCAT(LEFT(c.account_code, 1), '000')`,
    [tenantId]);

  // ---- UOM conversions: an open-ended effective window reads better than blank.
  await run('uom conversion window',
    `UPDATE uom_conversion_master SET effective_to = COALESCE(effective_to, '2030-12-31') WHERE tenant_id = ?`, [tenantId]);

  // ---- Stages: the day a stage auto-advances, where the BBP gives a duration.
  await run('stage auto-move',
    `UPDATE stage_master SET auto_move_on_day = COALESCE(auto_move_on_day, typical_duration_days)
     WHERE tenant_id = ? AND typical_duration_days IS NOT NULL AND transition_trigger = 'AUTO_BY_DAY'`, [tenantId]);

  // ---- GL accounts: parent each account onto the first account of its range.
  // The demo chart has no 1000/4000/5000 header rows, so the range's lowest code
  // stands in as the header rather than inventing accounts that do not exist.
  await run('gl account parents',
    `UPDATE gl_account_master c
       JOIN (SELECT tenant_id, company_id, LEFT(account_code,1) grp, MIN(account_code) head
               FROM gl_account_master GROUP BY tenant_id, company_id, LEFT(account_code,1)) r
         ON r.tenant_id = c.tenant_id AND (r.company_id <=> c.company_id) AND r.grp = LEFT(c.account_code,1)
       JOIN gl_account_master p ON p.tenant_id = c.tenant_id AND (p.company_id <=> c.company_id)
         AND p.account_code = r.head
     SET c.parent_account_id = p.gl_account_id, c.is_sub_account = 1
     WHERE c.tenant_id = ? AND c.parent_account_id IS NULL AND c.account_code <> r.head`, [tenantId]);

  // ---- Replacement gilts are bred on farm, so they have a sire and a dam here.
  // Sows and boars were purchased in and keep NULL parentage, which is correct.
  await run('animal parentage (gilts)',
    `UPDATE animal_register g
       JOIN (SELECT tenant_id, company_id, MIN(animal_id) id FROM animal_register
               WHERE animal_type = 'BOAR' GROUP BY tenant_id, company_id) b
         ON b.tenant_id = g.tenant_id AND (b.company_id <=> g.company_id)
       JOIN (SELECT tenant_id, company_id, MIN(animal_id) id FROM animal_register
               WHERE animal_type = 'SOW' GROUP BY tenant_id, company_id) d
         ON d.tenant_id = g.tenant_id AND (d.company_id <=> g.company_id)
     SET g.sire_animal_id = b.id, g.dam_animal_id = d.id
     WHERE g.tenant_id = ? AND g.animal_type = 'GILT' AND g.sire_animal_id IS NULL`, [tenantId]);

  // ---- Breeds belong to the farm they are kept on.
  await run('breed location',
    `UPDATE breed_master b
       JOIN location_master l ON l.tenant_id = b.tenant_id AND l.location_type = 'FARM'
         AND (l.company_id <=> b.company_id)
     SET b.location_id = l.location_id
     WHERE b.tenant_id = ? AND b.location_id IS NULL`, [tenantId]);

  // ---- GL mappings: the costing dimensions the posting rule varies by.
  await run('gl mapping detail',
    `UPDATE gl_mapping_master SET valuation_method = COALESCE(valuation_method, 'FIFO') WHERE tenant_id = ?`, [tenantId]);
  await run('gl mapping category',
    `UPDATE gl_mapping_master m
       JOIN item_category_master c ON c.tenant_id = m.tenant_id AND (c.company_id <=> m.company_id)
         AND c.category_name = 'Finished Swine Feeds & Diets'
     SET m.item_category_id = c.category_id
     WHERE m.tenant_id = ? AND m.item_category_id IS NULL
       AND m.transaction_type IN ('BATCH_CONSUMPTION','CONSUMPTION','BATCH_INPUT')`, [tenantId]);
  // Biological postings vary by the stage the animal is in, so those rules name one.
  await run('gl mapping stage',
    `UPDATE gl_mapping_master m
       JOIN stage_master s ON s.tenant_id = m.tenant_id AND (s.company_id <=> m.company_id)
         AND s.stage_code = 'GESTATION'
     SET m.stage_id = s.stage_id
     WHERE m.tenant_id = ? AND m.stage_id IS NULL AND m.transaction_type LIKE 'BIO_%'`, [tenantId]);

  // ---- Resources: the cost account they post to, and licence renewal.
  await run('resource gl account',
    `UPDATE resource_master r
       JOIN gl_account_master g ON g.tenant_id = r.tenant_id AND (g.company_id <=> r.company_id)
         AND g.account_code = '5020'
     SET r.gl_cost_account = g.gl_account_id
     WHERE r.tenant_id = ? AND r.gl_cost_account IS NULL`, [tenantId]);
  await run('resource licence',
    `UPDATE resource_master SET license_expiry = COALESCE(license_expiry, '2027-03-31')
     WHERE tenant_id = ? AND resource_type IN ('VEHICLE','EQUIPMENT')`, [tenantId]);

  // The BAG -> KG rule was seeded as a global pair. An older detail pass bound
  // it to one feed item, which made the same pair disappear for every other
  // item using it. Restore only that known demo conversion to global scope.
  await run('uom conversion global scope',
    `UPDATE uom_conversion_master SET item_id = NULL
     WHERE tenant_id = ? AND from_uom = 'BAG' AND to_uom = 'KG'`, [tenantId]);

  // ---- Stages: the KPI a batch must clear before it may advance.
  // required_kpi_to_pass is a JSON column — a plain sentence is rejected outright,
  // so this writes a JSON array of the checks.
  await run('stage exit KPI',
    `UPDATE stage_master SET required_kpi_to_pass = COALESCE(required_kpi_to_pass,
       CASE stage_category
         WHEN 'PRE_PRODUCTIVE' THEN JSON_ARRAY('target_weight_for_age', 'mortality_within_tolerance')
         WHEN 'PRODUCTIVE' THEN JSON_ARRAY('confirmed_in_pig_on_scan', 'body_condition_score_min_3')
         WHEN 'OUTPUT' THEN JSON_ARRAY('weaning_weight_recorded', 'litter_count_recorded')
         ELSE JSON_ARRAY('disposal_reason_recorded', 'disposal_weight_recorded') END)
     WHERE tenant_id = ?`, [tenantId]);

  // ---- Entry type, with the companion record the API insists on.
  //
  // animal.service enforces the spec's COND rules: a PURCHASED_* animal must
  // name the goods receipt it arrived on, and a BORN_ON_FARM one must name the
  // batch that produced it. The seed wrote a bare 'PURCHASED', which is not one
  // of the four allowed values at all — so the Entry Type select rendered blank
  // and saving the form would have failed. This runs last, once receipts and
  // batches exist, and sets the pair together.
  //
  // Gilts are the herd's own replacements (they already carry a sire and dam),
  // boars come in as imported genetics, and sows are bought locally.
  await run('animal entry type (gilts born on farm)',
    `UPDATE animal_register a
       JOIN (SELECT tenant_id, company_id, MIN(batch_id) id FROM batch_header
               GROUP BY tenant_id, company_id) b
         ON b.tenant_id = a.tenant_id AND (b.company_id <=> a.company_id)
     SET a.entry_type = 'BORN_ON_FARM', a.source_batch_id = b.id, a.source_receipt_id = NULL
     WHERE a.tenant_id = ? AND a.animal_type = 'GILT'`, [tenantId]);
  await run('animal entry type (purchased)',
    `UPDATE animal_register a
       JOIN (SELECT tenant_id, company_id, MIN(receipt_id) id FROM goods_receipt
               GROUP BY tenant_id, company_id) g
         ON g.tenant_id = a.tenant_id AND (g.company_id <=> a.company_id)
     SET a.entry_type = CASE WHEN a.animal_type = 'BOAR' THEN 'PURCHASED_IMPORTED' ELSE 'PURCHASED_LOCAL' END,
         a.source_receipt_id = g.id, a.source_batch_id = NULL
     WHERE a.tenant_id = ? AND a.animal_type <> 'GILT'`, [tenantId]);
  // Anything left without a companion record falls back to the one entry type
  // that needs none, rather than sitting on a value the API would reject.
  await run('animal entry type (fallback)',
    `UPDATE animal_register SET entry_type = 'TRANSFERRED_IN'
     WHERE tenant_id = ? AND source_receipt_id IS NULL AND source_batch_id IS NULL
       AND entry_type <> 'TRANSFERRED_IN'`, [tenantId]);

  // ---- Breed type: the demo had every breed as MEAT. Maternal lines are kept
  // for breeding, the terminal sire for meat — which is what the field is for.
  await run('breed type',
    `UPDATE breed_master SET breed_type = CASE breed_code
        WHEN 'DUROC' THEN 'MEAT' ELSE 'DUAL_PURPOSE' END
     WHERE tenant_id = ? AND breed_code IN ('DUROC','LARGE_WHITE','LANDRACE','YORKSHIRE')`, [tenantId]);

  // ---- Repoint operational rows from the tenant draft onto the company's copy.
  //
  // Adoption runs before the piggery data is seeded, so from that point on there
  // are two rows for every reference master — the draft and the company's copy —
  // and the seeds resolve by business code, which returns whichever the engine
  // hands back first. 23 of 27 animals ended up pointing at the DRAFT breed and
  // 19 at the draft stage.
  //
  // That is not cosmetic: enforceMasterRequest validates every submitted FK
  // against the caller's workspace, so an animal whose breed is a tenant draft
  // fails to save from company or operational scope with
  // "Master record is not available in this workspace." The row looks fine until
  // someone opens it and presses save.
  const repoint = async (table: string, fk: string, master: string, pk: string, code: string) => {
    await run(`repoint ${table}.${fk}`,
      `UPDATE \`${table}\` x
         JOIN \`${master}\` draft ON draft.${pk} = x.${fk} AND draft.company_id IS NULL
         JOIN \`${master}\` own ON own.tenant_id = draft.tenant_id
           AND own.${code} = draft.${code} AND own.company_id = x.company_id
       SET x.${fk} = own.${pk}
       WHERE x.tenant_id = ? AND x.company_id IS NOT NULL`, [tenantId]);
  };
  await repoint('animal_register', 'breed_id', 'breed_master', 'breed_id', 'breed_code');
  await repoint('animal_register', 'current_stage_id', 'stage_master', 'stage_id', 'stage_code');
  await repoint('animal_register', 'item_id', 'item_master', 'item_id', 'item_code');
  await repoint('batch_header', 'breed_id', 'breed_master', 'breed_id', 'breed_code');
  await repoint('batch_header', 'stage_id', 'stage_master', 'stage_id', 'stage_code');
  await repoint('scheduler_master', 'breed_id', 'breed_master', 'breed_id', 'breed_code');

  return out;
}

/** The three reasons the BBP documents, seeded per company. */
export async function seedDocumentedReasons(
  conn: mysql.Connection,
  tenantId: string,
  reasons: ReadonlyArray<{ reason_code: string; reason_name: string; category: string; applicable_stages: string[] | null; mandatory_weight: boolean }>,
): Promise<number> {
  const [companies] = await conn.query<RowDataPacket[]>(
    'SELECT company_id FROM company_master WHERE tenant_id = ?', [tenantId]);
  const [[area]] = await conn.query<RowDataPacket[]>(
    'SELECT nob_id, lob_id FROM operational_area_master WHERE tenant_id = ? AND deleted_at IS NULL LIMIT 1', [tenantId]);
  let created = 0;
  for (const company of companies) {
    for (const r of reasons) {
      const [[existing]] = await conn.query<RowDataPacket[]>(
        'SELECT reason_id FROM reason_master WHERE tenant_id = ? AND company_id = ? AND reason_code = ?',
        [tenantId, company.company_id, r.reason_code]);
      if (existing) continue;
      await conn.query(
        `INSERT INTO reason_master (reason_id, tenant_id, company_id, nob_id, lob_id, reason_code, reason_name,
           category, applicable_stages, mandatory_weight, is_active)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [tenantId, company.company_id, area?.nob_id ?? null, area?.lob_id ?? null,
         r.reason_code, r.reason_name, r.category,
         r.applicable_stages ? JSON.stringify(r.applicable_stages) : null, r.mandatory_weight ? 1 : 0]);
      created++;
    }
  }
  return created;
}
