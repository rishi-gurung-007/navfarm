/**
 * Demo data for the common requisition (WP4a — master plan
 * docs/superpowers/plans/2026-10-04-feed-master-completion-plan.md, "Build
 * order (Rishi, 5 Oct)" step 3).
 *
 * Until this ran, the local demo database had no DEPARTMENT cost centres, no
 * location or user department and no lot- or serial-tracked item. The department
 * checks on Transfer Shipment / Transfer Receipt (assertPostingDepartment,
 * 143ebb1a) therefore returned early on every document, and Item Tracking
 * (0483df28, 6d4317b1, c9bacdd9) had nothing to track — both untested live.
 *
 * For each company that holds an active STORE sub-location this script adds,
 * all labelled illustrative:
 *   1. two DEPARTMENT cost centres, DEPT-STORES "Stores (illustrative)" and
 *      DEPT-FARM-OPS "Farm Operations (illustrative)" — typed codes, because the
 *      COST_CENTER number series is seeded blocked ("typed, not generated");
 *   2. location_master.department_id: STORE -> Stores, SHED and FARM -> Farm
 *      Operations; NULL rows only, never overwriting;
 *   3. user_master.department_id for the seeded demo users (company.admin ->
 *      Stores; area.admin and user@ -> Farm Operations); NULL rows only; and a
 *      standing operational area for area.admin when it holds none (without
 *      one every operational call it makes is refused);
 *   4. the ITEM_LOT / ITEM_SERIAL number series (SYSTEM_NO_SERIES_SEED, PR #13)
 *      if missing, and one lot-tracked and one serial-tracked item
 *      (ILL-LOT-001, ILL-SER-001) cloned from the company's medicine posting
 *      set-up.
 *
 * Stock is NOT written here. The items get stock through a real Goods Receipt
 * posted through the running API (POST /goods-receipt, then /:id/post), which
 * writes the ledger and the journal itself — never a raw ledger INSERT.
 *
 * Default is read-only (prints the plan); --verify applies and rolls back;
 * --apply commits. Local databases only. Idempotent: a second run plans nothing.
 * The database is DEV_TENANT_DATABASE (default nf_devco).
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import {
  planAreaAssignments,
  planDepartmentCostCenters,
  planLocationDepartments,
  planTrackedItems,
  planTrackingSeries,
  planUserDepartments,
  storeCapableCompanies,
  type CompanyLocationRow,
  type CostCenterRow,
  type DepartmentIds,
  type ItemSourceRow,
  type SeriesRow,
} from './align-requisition-demo-data.lib';

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const host = process.env.DATABASE_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Refusing non-local host '${host}' — this script may only touch local demo databases.`);
  }
  const database = process.env.DEV_TENANT_DATABASE || 'nf_devco';
  const db = await mysql.createConnection({
    host, port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USERNAME || 'root', password: process.env.DATABASE_PASSWORD || '',
    database, ssl: process.env.DATABASE_SSL === 'true' ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true } : undefined,
  });
  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-requisition-demo-data', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another requisition demo-data run is active.');
    await db.beginTransaction();
    const write = verify || apply;

    const [companyRows] = await db.query<RowDataPacket[]>('SELECT company_id, tenant_id, company_code FROM company_master');
    const tenantOf = new Map(companyRows.map((c) => [c.company_id as string, c.tenant_id as string]));
    const codeOf = new Map(companyRows.map((c) => [c.company_id as string, c.company_code as string]));

    const [locations] = await db.query<RowDataPacket[]>(
      `SELECT location_id, location_code, location_type, company_id, is_active, department_id
         FROM location_master WHERE deleted_at IS NULL ORDER BY location_code`,
    );
    const companies = storeCapableCompanies(locations as unknown as CompanyLocationRow[]);

    // 1. Department cost centres.
    const [costCenters] = await db.query<RowDataPacket[]>(
      'SELECT cost_center_id, company_id, cost_center_code, cost_center_type, deleted_at FROM cost_center_master',
    );
    const [series] = await db.query<RowDataPacket[]>('SELECT id, code, company_id, blocked, deleted_at FROM no_series');
    const deptPlan = planDepartmentCostCenters(companies, costCenters as unknown as CostCenterRow[], series as unknown as SeriesRow[]);
    const departmentIds: DepartmentIds = new Map();
    for (const e of deptPlan.existing) departmentIds.set(e.company_id, { ...departmentIds.get(e.company_id), [e.key]: e.cost_center_id });
    const createdCostCenters: Array<{ cost_center_id: string; company: string; code: string; name: string }> = [];
    for (const c of deptPlan.create) {
      const id = randomUUID();
      if (write) {
        await db.query(
          `INSERT INTO cost_center_master (cost_center_id, tenant_id, company_id, cost_center_code, cost_center_name, cost_center_type, is_active, status)
           VALUES (?, ?, ?, ?, ?, 'DEPARTMENT', 1, 'ACTIVE')`,
          [id, tenantOf.get(c.company_id), c.company_id, c.cost_center_code, c.cost_center_name],
        );
      }
      // Read-only runs still plan downstream rows against a placeholder id.
      departmentIds.set(c.company_id, { ...departmentIds.get(c.company_id), [c.key]: write ? id : `(new ${c.cost_center_code})` });
      createdCostCenters.push({ cost_center_id: write ? id : '(planned)', company: codeOf.get(c.company_id) ?? c.company_id, code: c.cost_center_code, name: c.cost_center_name });
    }

    // 2. Location departments (NULL only).
    const locPlan = planLocationDepartments(locations as unknown as CompanyLocationRow[], departmentIds);
    if (write) {
      for (const l of locPlan.set) {
        await db.query('UPDATE location_master SET department_id = ? WHERE location_id = ? AND department_id IS NULL', [l.department_id, l.location_id]);
      }
    }

    // 3. User departments (NULL only).
    const [users] = await db.query<RowDataPacket[]>('SELECT user_id, email, company_id, department_id FROM user_master');
    const userPlan = planUserDepartments(users as never, departmentIds);
    if (write) {
      for (const u of userPlan.set) {
        await db.query('UPDATE user_master SET department_id = ? WHERE user_id = ? AND department_id IS NULL', [u.department_id, u.user_id]);
      }
    }

    // 3b. A standing operational area for the operational-admin persona (none held only).
    const [areaUsers] = await db.query<RowDataPacket[]>('SELECT user_id, email, user_type, company_id FROM user_master WHERE deleted_at IS NULL');
    const [areaAssignments] = await db.query<RowDataPacket[]>('SELECT user_id, area_id FROM user_operational_area_assignment');
    const [areas] = await db.query<RowDataPacket[]>('SELECT area_id, company_id, area_code, is_active, deleted_at FROM operational_area_master');
    const areaPlan = planAreaAssignments(areaUsers as never, areaAssignments as never, areas as never);
    if (write) {
      for (const [i, a] of areaPlan.entries()) {
        await db.query(
          'INSERT INTO user_operational_area_assignment (assignment_id, user_id, area_id, company_id, is_primary) VALUES (?, ?, ?, ?, ?)',
          [randomUUID(), a.user_id, a.area_id, a.company_id, i === 0 ? 1 : 0],
        );
      }
    }

    // 4. Tracking series and tracked items.
    const tenantIds = [...new Set(companies.map((c) => tenantOf.get(c)).filter((t): t is string => Boolean(t)))];
    const seriesPlan = tenantIds.flatMap((t) => planTrackingSeries(series as unknown as SeriesRow[], t));
    const newSeriesIds: Record<string, string> = {};
    for (const s of seriesPlan) {
      const id = randomUUID();
      newSeriesIds[s.code] = id;
      if (write) {
        await db.query(
          `INSERT INTO no_series (id, tenant_id, company_id, code, description, document_type, master_type, no_series_code, prefix, \`separator\`, seq_length, current_seq, reset_frequency, manual_nos, blocked)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          [id, s.tenant_id, s.code, s.description, s.document_type, s.master_type, s.no_series_code, s.prefix, s.separator, s.seq_length, s.reset_frequency, s.manual_nos, s.blocked],
        );
      }
    }
    const seriesIdFor = (code: string, companyId: string): string | undefined =>
      (series.find((s) => s.code === code && s.company_id === companyId && !s.deleted_at)?.id as string | undefined)
      ?? (series.find((s) => s.code === code && s.company_id === null && !s.deleted_at)?.id as string | undefined)
      ?? (write ? newSeriesIds[code] : newSeriesIds[code] && `(new ${code})`);

    const [sources] = await db.query<RowDataPacket[]>(
      `SELECT item_id, company_id, item_code, item_type, category_id, nob_id, lob_id, sub_category, valuation_method
         FROM item_master WHERE is_active = 1 AND deleted_at IS NULL AND is_lot_tracked = 0 AND is_serial_tracked = 0`,
    );
    const [existingItems] = await db.query<RowDataPacket[]>('SELECT company_id, item_code FROM item_master');
    const itemPlans = companies.map((c) => planTrackedItems([c], sources as unknown as ItemSourceRow[], existingItems as never, {
      LOT: seriesIdFor('ITEM_LOT', c), SERIAL: seriesIdFor('ITEM_SERIAL', c),
    }));
    const createdItems: Array<{ item_id: string; item_code: string; tracking: string; cloned_from: string }> = [];
    for (const i of itemPlans.flatMap((p) => p.create)) {
      const id = randomUUID();
      if (write) {
        await db.query(
          `INSERT INTO item_master
             (item_id, tenant_id, company_id, item_code, item_name, item_type, nob_id, lob_id, sub_category, category_id, uom_primary,
              valuation_method, is_lot_tracked, is_serial_tracked, tracking_series_id, is_biological_asset, is_inventoriable, is_active, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 1, 'ACTIVE')`,
          [id, tenantOf.get(i.company_id), i.company_id, i.item_code, i.item_name, i.item_type, i.nob_id, i.lob_id, i.sub_category, i.category_id,
            i.uom_primary, i.valuation_method, i.is_lot_tracked, i.is_serial_tracked, i.tracking_series_id],
        );
      }
      createdItems.push({ item_id: write ? id : '(planned)', item_code: i.item_code, tracking: i.is_lot_tracked ? 'LOT' : 'SERIAL', cloned_from: i.cloned_from });
    }

    const [after] = await db.query<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM cost_center_master WHERE cost_center_type = 'DEPARTMENT' AND deleted_at IS NULL) departments,
         (SELECT COUNT(*) FROM location_master WHERE department_id IS NOT NULL) locations_with_department,
         (SELECT COUNT(*) FROM user_master WHERE department_id IS NOT NULL) users_with_department,
         (SELECT COUNT(*) FROM no_series WHERE code IN ('ITEM_LOT','ITEM_SERIAL') AND deleted_at IS NULL) tracking_series,
         (SELECT COUNT(*) FROM item_master WHERE is_lot_tracked = 1 OR is_serial_tracked = 1) tracked_items`,
    );

    const byDept = (rows: Array<{ department: string }>) => rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.department]: (acc[r.department] ?? 0) + 1 }), {});
    console.log(JSON.stringify({
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      storeCapableCompanies: companies.map((c) => codeOf.get(c) ?? c),
      departments: { create: createdCostCenters, existing: deptPlan.existing, blocked: deptPlan.blocked },
      locations: { set: locPlan.set.length, byDepartment: byDept(locPlan.set), keptExisting: locPlan.keptExisting, codes: locPlan.set.map((l) => `${l.location_code} -> ${l.department}`) },
      users: { set: userPlan.set.map((u) => `${u.email} -> ${u.department}`), keptExisting: userPlan.keptExisting },
      operationalAreas: areaPlan.map((a) => `${a.email} -> ${a.area_code}`),
      trackingSeries: seriesPlan.map((s) => `${s.code} (${s.document_type}, prefix ${s.prefix}, ${s.seq_length} digits)`),
      trackedItems: { create: createdItems, skipped: itemPlans.flatMap((p) => p.skipped) },
      countsAfter: after[0],
      stock: 'not written here — post a Goods Receipt through the running API for ILL-LOT-001 / ILL-SER-001',
    }, null, 2));

    if (apply) {
      await db.commit();
      console.log('Committed.');
    } else {
      await db.rollback();
      console.log(verify ? 'Verified and rolled back. No changes committed.' : 'Read-only. No changes attempted.');
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-requisition-demo-data')");
    await db.end();
  }
}

if (require.main === module) {
  run().catch((err) => { console.error(err.message); process.exit(1); });
}
