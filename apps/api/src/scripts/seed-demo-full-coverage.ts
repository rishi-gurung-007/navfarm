import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import * as mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { eq, and, desc, inArray } from 'drizzle-orm';
import * as schema from '../core/database/schema';
import { SEED_KEY_BY_ITEM_NAME } from './lib/seed-item-catalog';
import { seriesCodeFor } from './lib/seed-series-code';
import { seedDefaultCompanyRoles } from '../modules/core/role/default-role-seed';

/**
 * Fills every gap left by seed-dev-tenant.ts + seed-piggery-complete-data.ts
 * so no page in the demo shows "no data found": Company 2's animal register,
 * a batch transfer, a custom role + OPERATIONAL_ADMIN users, inventory
 * (goods receipt/issue/transfer/adjustment with real FIFO application),
 * finance journals, QC, QR/traceability, in-app notifications, approvals,
 * and an audit trail. Every section is independently idempotent (select
 * before insert) and wrapped so one section's failure doesn't abort the rest
 * — rerun freely.
 */

const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;
const tenantCode = process.env.DEV_TENANT_CODE || 'devco';
const dbName = `tenant_${tenantCode}`;

const d4 = (n: number) => n.toFixed(4);
const todayMinus = (days: number) => {
  const d = new Date('2026-08-20T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};
const tsMinus = (days: number, hour = 9) => {
  const d = new Date('2026-08-20T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

async function run(label: string, fn: () => Promise<void>) {
  console.log(`\n⏳ ${label}...`);
  try {
    await fn();
    console.log(`✅ ${label} done.`);
  } catch (err: any) {
    console.error(`❌ ${label} failed: ${err?.message || err}`);
  }
}

export async function seedFullCoverage() {
  console.log(`Starting full-coverage demo data seed into ${dbName}...`);
  const pool = mysql.createPool({ host, port, user, password, database: dbName, ssl });
  const db = drizzle(pool, { schema, mode: 'default' });

  try {
    const companies = await db.select().from(schema.companyMaster);
    // The demo is one company now; this script was written when it was two and
    // demanded both by code. Falling back to the first keeps every section that
    // was written "for company 2" running against the company that exists,
    // rather than the whole stage failing on a name that was renamed.
    const comp1 = companies[0];
    const comp2 = companies[1] || companies[0];
    if (!comp1) throw new Error('No company found — run db-seed-dev-tenant first.');
    const tenantId = comp1.tenant_id;
    const comp1Id = comp1.company_id;
    const comp2Id = comp2.company_id;

    // By scope, not by email — the demo's emails moved when it was renamed to
    // Triple C, and looking them up by address made this stage fail on a name.
    const [tAdmin] = await db.select().from(schema.userMaster).where(eq(schema.userMaster.user_type, 'TENANT_ADMIN')).limit(1);
    const [c1Admin] = await db.select().from(schema.userMaster).where(eq(schema.userMaster.user_type, 'COMPANY_ADMIN')).limit(1);
    if (!tAdmin) throw new Error('No TENANT_ADMIN found — run db-seed-dev-tenant first.');
    const c2Admin = c1Admin ?? tAdmin;

    const [nob] = await db.select().from(schema.nobMaster).where(eq(schema.nobMaster.nob_code, 'LIVESTOCK')).limit(1);
    const [lob] = await db.select().from(schema.lobMaster).where(eq(schema.lobMaster.lob_code, 'LVS_PIGGERY')).limit(1);
    if (!nob || !lob) throw new Error('NOB LIVESTOCK / LOB LVS_PIGGERY not found.');
    const nobId = nob.nob_id;
    const lobId = lob.lob_id;

    const breeds = await db.select().from(schema.breedMaster);
    const breedByCode = new Map(breeds.map((b) => [b.breed_code, b]));

    const itemsAll = await db.select().from(schema.itemMaster);
    // Keyed by the seed's own handle (RAW-MAIZE-CORN), not by item_code: codes
    // now come from the ITEM series and move whenever the category codes do.
    const itemMap1 = new Map(itemsAll.filter((i) => i.company_id === comp1Id)
      .map((i) => [SEED_KEY_BY_ITEM_NAME[i.item_name] ?? i.item_code, i]));
    const itemMap2 = new Map(itemsAll.filter((i) => i.company_id === comp2Id)
      .map((i) => [SEED_KEY_BY_ITEM_NAME[i.item_name] ?? i.item_code, i]));

    const locationsAll = await db.select().from(schema.locationMaster);
    const locMap2 = new Map(locationsAll.filter((l) => l.company_id === comp2Id).map((l) => [l.location_code, l]));

    // By company, not by hardcoded area code. The codes moved with the rename,
    // and there is one area per company now rather than one named APEX-BREED-01
    // and another named HIGH-GROW-01.
    const [area1] = await db.select().from(schema.operationalAreaMaster)
      .where(eq(schema.operationalAreaMaster.company_id, comp1Id)).limit(1);
    const [area2] = await db.select().from(schema.operationalAreaMaster)
      .where(eq(schema.operationalAreaMaster.company_id, comp2Id)).limit(1);
    if (!area1) throw new Error('No operational area found — run db-seed-dev-tenant first.');

    const batches1 = await db.select().from(schema.batchHeader).where(eq(schema.batchHeader.company_id, comp1Id));
    const batches2 = await db.select().from(schema.batchHeader).where(eq(schema.batchHeader.company_id, comp2Id));
    const batch1a = batches1.find((b) => b.batch_no === 'PIG-BAT-2026-0001');
    const batch1b = batches1.find((b) => b.batch_no === 'PIG-BAT-2026-0002');
    const batch2a = batches2.find((b) => b.batch_no === 'PIG-BAT-2026-0101');
    const batch2b = batches2.find((b) => b.batch_no === 'PIG-BAT-2026-0102');
    if (!batch1a || !batch1b || !batch2a || !batch2b) throw new Error('Expected batches not found.');

    const [warehouse1] = await db.select().from(schema.locationMaster).where(and(eq(schema.locationMaster.company_id, comp1Id), inArray(schema.locationMaster.location_type, ['STORE', 'SILO']))).limit(1);
    const [warehouse2] = await db.select().from(schema.locationMaster).where(and(eq(schema.locationMaster.company_id, comp2Id), inArray(schema.locationMaster.location_type, ['STORE', 'SILO']))).limit(1);
    if (!warehouse1 || !warehouse2) throw new Error('Warehouses not found.');

    const glAll = await db.select().from(schema.glAccountMaster);
    const glMap1 = new Map(glAll.filter((g) => g.company_id === comp1Id).map((g) => [g.account_code, g.gl_account_id]));
    const glMap2 = new Map(glAll.filter((g) => g.company_id === comp2Id).map((g) => [g.account_code, g.gl_account_id]));

    const costCentersAll = await db.select().from(schema.costCenterMaster);
    const ccMap1 = new Map(costCentersAll.filter((c) => c.company_id === comp1Id).map((c) => [c.cost_center_code, c.cost_center_id]));
    const ccMap2 = new Map(costCentersAll.filter((c) => c.company_id === comp2Id).map((c) => [c.cost_center_code, c.cost_center_id]));

    console.log(`Context: Tenant ${tenantId} — APEXBREED (${comp1Id}) / HIGHLAND (${comp2Id})`);

    // ═══════════════════════════════════════════════════════════════════
    // 1. HIGHLAND animal register
    // ═══════════════════════════════════════════════════════════════════
    let highlandAnimals: (typeof schema.animalRegister.$inferSelect)[] = [];
    await run('Section 1: HIGHLAND animal register', async () => {
      const existing = await db.select().from(schema.animalRegister).where(eq(schema.animalRegister.company_id, comp2Id));
      if (existing.length > 0) {
        highlandAnimals = existing;
        console.log(`  already has ${existing.length} animals, skipping.`);
        return;
      }
      const piglet = itemMap2.get('BIO-SWINE-PIGLET');
      const finisher = itemMap2.get('BIO-SWINE-FINISHER');
      if (!piglet || !finisher) throw new Error('HIGHLAND bio items not found.');
      const nursPen = locMap2.get('PEN-NURS-01');
      const growPen = locMap2.get('PEN-GROW-02');
      const finPen = locMap2.get('PEN-FIN-03');
      const animalCfgs = [
        { code: 'PIG-2026-0101', type: 'PIGLET', breed: 'DUROC', gender: 'F', tag: 'PLT-DR-101', rfid: '982000412881101', cost: '4200.0000', item: piglet, loc: nursPen },
        { code: 'PIG-2026-0102', type: 'PIGLET', breed: 'DUROC', gender: 'M', tag: 'PLT-DR-102', rfid: '982000412881102', cost: '4200.0000', item: piglet, loc: nursPen },
        { code: 'PIG-2026-0103', type: 'PIGLET', breed: 'LANDRACE', gender: 'F', tag: 'PLT-LR-103', rfid: '982000412881103', cost: '4200.0000', item: piglet, loc: nursPen },
        { code: 'PIG-2026-0104', type: 'COMMERCIAL_PIG', breed: 'DUROC', gender: 'M', tag: 'GRW-DR-104', rfid: '982000412881104', cost: '7800.0000', item: growPen ? finisher : piglet, loc: growPen },
        { code: 'PIG-2026-0105', type: 'COMMERCIAL_PIG', breed: 'DUROC', gender: 'F', tag: 'GRW-DR-105', rfid: '982000412881105', cost: '7800.0000', item: finisher, loc: growPen },
        { code: 'PIG-2026-0106', type: 'COMMERCIAL_PIG', breed: 'LANDRACE', gender: 'M', tag: 'GRW-LR-106', rfid: '982000412881106', cost: '7800.0000', item: finisher, loc: growPen },
        { code: 'PIG-2026-0107', type: 'COMMERCIAL_PIG', breed: 'DUROC', gender: 'F', tag: 'GRW-DR-107', rfid: '982000412881107', cost: '7800.0000', item: finisher, loc: growPen },
        { code: 'PIG-2026-0108', type: 'COMMERCIAL_PIG', breed: 'DUROC', gender: 'M', tag: 'FIN-DR-108', rfid: '982000412881108', cost: '12500.0000', item: finisher, loc: finPen },
        { code: 'PIG-2026-0109', type: 'COMMERCIAL_PIG', breed: 'DUROC', gender: 'F', tag: 'FIN-DR-109', rfid: '982000412881109', cost: '12500.0000', item: finisher, loc: finPen },
        { code: 'PIG-2026-0110', type: 'COMMERCIAL_PIG', breed: 'LANDRACE', gender: 'M', tag: 'FIN-LR-110', rfid: '982000412881110', cost: '12500.0000', item: finisher, loc: finPen },
        { code: 'PIG-2026-0111', type: 'COMMERCIAL_PIG', breed: 'DUROC', gender: 'F', tag: 'FIN-DR-111', rfid: '982000412881111', cost: '12500.0000', item: finisher, loc: finPen },
        { code: 'PIG-2026-0112', type: 'PIGLET', breed: 'LANDRACE', gender: 'M', tag: 'PLT-LR-112', rfid: '982000412881112', cost: '4200.0000', item: piglet, loc: nursPen },
      ];
      for (const a of animalCfgs) {
        const breed = breedByCode.get(a.breed) || breeds[0];
        const animalId = randomUUID();
        const row: typeof schema.animalRegister.$inferInsert = {
          animal_id: animalId,
          tenant_id: tenantId,
          company_id: comp2Id,
          nob_id: nobId,
          lob_id: lobId,
          animal_code: a.code,
          animal_type: a.type,
          breed_id: breed.breed_id,
          gender: a.gender,
          entry_type: 'PURCHASED_LOCAL',
          entry_date: '2026-06-15',
          item_id: (a.item || piglet)!.item_id,
          ear_tag: a.tag,
          rfid_tag: a.rfid,
          acquisition_cost: a.cost,
          total_opening_asset_value: a.cost,
          book_value: a.cost,
          current_bio_asset_value: a.cost,
          current_location_id: a.loc?.location_id,
          current_batch_id: a.type === 'PIGLET' ? batch2a!.batch_id : batch2a!.batch_id,
          status: 'ACTIVE',
          is_active: true,
          created_by: c2Admin.user_id,
        };
        await db.insert(schema.animalRegister).values(row);
        highlandAnimals.push(row as any);
      }
      console.log(`  inserted ${animalCfgs.length} HIGHLAND animals.`);
    });

    // ═══════════════════════════════════════════════════════════════════
    // 2. Batch transfer within APEXBREED
    // ═══════════════════════════════════════════════════════════════════
    await run('Section 2: Batch transfer (APEXBREED)', async () => {
      const existing = await db.select().from(schema.batchTransfer).where(eq(schema.batchTransfer.company_id, comp1Id)).limit(1);
      if (existing.length > 0) {
        console.log('  transfer already exists, skipping.');
        return;
      }
      const gilts = await db.select().from(schema.animalRegister)
        .where(and(eq(schema.animalRegister.company_id, comp1Id), eq(schema.animalRegister.animal_type, 'GILT')));
      const moving = gilts.slice(0, 2);
      if (moving.length === 0) throw new Error('No GILT animals found on APEXBREED to transfer.');

      for (const g of moving) {
        await db.update(schema.animalRegister).set({ current_batch_id: batch1a!.batch_id }).where(eq(schema.animalRegister.animal_id, g.animal_id));
      }

      const transferId = randomUUID();
      await db.insert(schema.batchTransfer).values({
        transfer_id: transferId,
        tenant_id: tenantId,
        company_id: comp1Id,
        transfer_no: 'BTR-2026-0001',
        from_batch_id: batch1a!.batch_id,
        to_batch_id: batch1b!.batch_id,
        transfer_date: todayMinus(5),
        transfer_type: 'PARTIAL',
        head_count: d4(moving.length),
        transfer_value: d4(moving.reduce((s, a) => s + Number(a.book_value || a.acquisition_cost || 0), 0)),
        reason: 'STAGE_PROGRESSION',
        remarks: 'Gilts moved from gestation cohort into farrowing/lactation cohort.',
        status: 'POSTED',
        posted_at: tsMinus(5),
        posted_by: c1Admin.user_id,
        created_by: c1Admin.user_id,
      });
      let lineNo = 1;
      for (const g of moving) {
        await db.insert(schema.batchTransferLine).values({
          line_id: randomUUID(),
          transfer_id: transferId,
          line_no: lineNo++,
          animal_id: g.animal_id,
          from_location_id: g.current_location_id,
          to_location_id: g.current_location_id,
          book_value: g.book_value || g.acquisition_cost || '0.0000',
        });
        await db.update(schema.animalRegister).set({ current_batch_id: batch1b!.batch_id }).where(eq(schema.animalRegister.animal_id, g.animal_id));
      }
      console.log(`  transferred ${moving.length} animals ${batch1a!.batch_no} -> ${batch1b!.batch_no}.`);
    });

    // ═══════════════════════════════════════════════════════════════════
    // 3. Custom role + OPERATIONAL_ADMIN users
    // ═══════════════════════════════════════════════════════════════════
    for (const [compId, admin, areaId, tag] of [
      [comp1Id, c1Admin, area1.area_id, 'apex'],
      [comp2Id, c2Admin, (area2 ?? area1).area_id, 'highland'],
    ] as const) {
      await run(`Section 3: FARM_SUPERVISOR role + operational admin (${tag})`, async () => {
        const [role] = await db.select().from(schema.roleMaster).where(and(eq(schema.roleMaster.company_id, compId), eq(schema.roleMaster.role_code, 'FARM_SUPERVISOR'))).limit(1);
        let roleId = role?.role_id;
        if (!role) {
          roleId = randomUUID();
          await db.insert(schema.roleMaster).values({
            role_id: roleId,
            company_id: compId,
            role_code: 'FARM_SUPERVISOR',
            role_name: 'Farm Supervisor',
            role_description: 'Day-to-day farm supervision — batch/feed operations plus visibility into settings',
            is_system_role: false,
            is_active: true,
          });
          // module_code/resource must match the @RequirePermission pairs the
          // controllers actually guard on. The previous POULTRY/BATCH_CONTROL
          // and POULTRY/FEED_LOGS grants matched nothing, so a supervisor got
          // 403 on batches, animals and operational areas — an empty console.
          const rw = (module: string, resource: string, approve = false) => ({
            role_id: roleId!, module_code: module, resource,
            can_view: true, can_create: true, can_edit: true, can_delete: false,
            can_approve: approve, can_export: true, can_print: true,
          });
          const ro = (module: string, resource: string) => ({
            role_id: roleId!, module_code: module, resource,
            can_view: true, can_create: false, can_edit: false, can_delete: false,
            can_approve: false, can_export: true, can_print: true,
          });
          await db.insert(schema.rolePermissions).values([
            rw('PRODUCTION', 'BATCH', true),
            rw('PRODUCTION', 'QC'),
            rw('PRODUCTION', 'APPROVAL'),
            ro('PRODUCTION', 'STAGE'),
            ro('PRODUCTION', 'BATCH_SCHEDULE'),
            ro('PRODUCTION', 'PARAMETER'),
            ro('PRODUCTION', 'QC_PARAMETER'),
            ro('PRODUCTION', 'QR_CODE'),
            rw('PIGGERY', 'ANIMAL', true),
            rw('INVENTORY', 'GOODS_ISSUE'),
            rw('INVENTORY', 'GOODS_RECEIPT'),
            rw('INVENTORY', 'STOCK_TRANSFER'),
            rw('INVENTORY', 'STOCK_ADJUSTMENT'),
            ro('INVENTORY', 'LEDGER'),
            ro('INVENTORY', 'BIO_ASSET_LEDGER'),
            ro('FINANCE', 'REPORTS'),
            ro('AUDIT', 'LOGS'),
            ro('NOTIFICATION', 'SETTINGS'),
            ro('SYSTEM', 'NUMBER_SERIES'),
            ...['BREED', 'BREED_LIFECYCLE_STAGE', 'COST_CENTER', 'CUSTOMER', 'DISEASE', 'FARM',
                'FEED_FORMULA', 'GL_ACCOUNT', 'GL_MAPPING', 'ITEM', 'ITEM_ATTRIBUTE',
                'ITEM_CATEGORY', 'LOCATION', 'MEDICINE', 'OPERATIONAL_AREA', 'RESOURCE',
                'SHED', 'SPECIES', 'SUPPLIER', 'UOM', 'WAREHOUSE'].map((r) => ro('MASTER_DATA', r)),
            ro('COMPANY', 'SETTINGS'),
          ]);
        }

        // The operational admin the dev tenant seeds, not a second one of this
        // script's own. It used to mint supervisor@apexpork.local and
        // supervisor@highlandpork.local — invented people on a Zimbabwe piggery —
        // so a full chain ended with three operational admins for one area.
        const [existingUser] = await db.select().from(schema.userMaster)
          .where(eq(schema.userMaster.user_type, 'OPERATIONAL_ADMIN')).limit(1);
        const email = existingUser?.email ?? `supervisor@${tag}pork.local`;
        let userId = existingUser?.user_id;
        if (!existingUser) {
          userId = randomUUID();
          const passwordHash = await bcrypt.hash('12345678', 10);
          await db.insert(schema.userMaster).values({
            user_id: userId,
            company_id: compId,
            tenant_id: tenantId,
            full_name: tag === 'apex' ? 'Meera Nair (Farm Supervisor)' : 'Suresh Rathi (Farm Supervisor)',
            email,
            password_hash: passwordHash,
            auth_provider: 'EMAIL',
            user_type: 'OPERATIONAL_ADMIN',
            designation: 'Farm Supervisor',
            is_active: true,
            invited_by: admin.user_id,
          });
          await db.insert(schema.userCompanyAssignments).values({
            assign_id: randomUUID(),
            user_id: userId!,
            company_id: compId,
            is_primary: true,
            is_active: true,
            assigned_by: admin.user_id,
          });
          await db.insert(schema.userRoleAssignment).values({
            assign_id: randomUUID(),
            user_id: userId!,
            role_id: roleId!,
            assigned_by: admin.user_id,
          });
          await db.insert(schema.userOperationalAreaAssignment).values({
            assignment_id: randomUUID(),
            user_id: userId!,
            area_id: areaId,
            company_id: compId,
            is_primary: true,
          });
          console.log(`  created ${email} (OPERATIONAL_ADMIN, FARM_SUPERVISOR).`);
        } else {
          console.log(`  ${email} already exists, skipping.`);
        }
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 3.5. Default company roles (SUPER_ADMIN/MANAGER/ACCOUNTANT/OPERATOR)
    // Every real signup gets these via CompanyService.create() — the raw
    // seed scripts insert companies directly and skip that hook, which
    // left both companies with zero default roles and the 3 original
    // admin users with no role assignment at all. Backfilling it here so
    // the Roles/Users pages and permission checks match a real company.
    // ═══════════════════════════════════════════════════════════════════
    for (const [compId, admin] of [[comp1Id, c1Admin], [comp2Id, c2Admin]] as const) {
      await run(`Section 3.5: Default roles + admin assignment (${compId === comp1Id ? 'apex' : 'highland'})`, async () => {
        const existingDefaults = await db.select().from(schema.roleMaster).where(and(eq(schema.roleMaster.company_id, compId), eq(schema.roleMaster.is_system_role, true))).limit(1);
        let superAdminRoleId: string;
        if (existingDefaults.length === 0) {
          const seeded = await seedDefaultCompanyRoles(db, compId);
          superAdminRoleId = seeded.superAdminRoleId;
          console.log('  seeded SUPER_ADMIN/MANAGER/ACCOUNTANT/OPERATOR.');
        } else {
          const [sa] = await db.select().from(schema.roleMaster).where(and(eq(schema.roleMaster.company_id, compId), eq(schema.roleMaster.role_code, 'SUPER_ADMIN'))).limit(1);
          superAdminRoleId = sa!.role_id;
          console.log('  default roles already present.');
        }

        for (const u of [tAdmin, admin]) {
          const [existingAssign] = await db.select().from(schema.userRoleAssignment).where(eq(schema.userRoleAssignment.user_id, u.user_id)).limit(1);
          if (!existingAssign) {
            await db.insert(schema.userRoleAssignment).values({ assign_id: randomUUID(), user_id: u.user_id, role_id: superAdminRoleId, assigned_by: u.user_id });
            console.log(`  assigned ${u.email} -> SUPER_ADMIN.`);
          }
        }
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 4 & 5. Inventory (GRN, issue, transfer, adjustment) + finance journals
    // ═══════════════════════════════════════════════════════════════════
    async function postJournal(compId: string, glMap: Map<string, string>, journalNo: string, postingDate: string, sourceDocType: string, sourceDocNo: string, sourceLedgerId: string | undefined, debitCode: string, creditCode: string, amount: number, description: string, createdBy: string) {
      const debitId = glMap.get(debitCode);
      const creditId = glMap.get(creditCode);
      if (!debitId || !creditId) throw new Error(`GL accounts ${debitCode}/${creditCode} not found.`);
      const journalId = randomUUID();
      await db.insert(schema.journalHeader).values({
        journal_id: journalId,
        tenant_id: tenantId,
        company_id: compId,
        journal_no: journalNo,
        posting_date: postingDate,
        source: 'SYSTEM',
        source_document_type: sourceDocType,
        source_document_no: sourceDocNo,
        source_ledger_id: sourceLedgerId,
        description,
        status: 'POSTED',
        total_debit: d4(amount),
        total_credit: d4(amount),
        posted_at: `${postingDate} 10:00:00`,
        posted_by: createdBy,
        created_by: createdBy,
      });
      await db.insert(schema.journalLine).values([
        { line_id: randomUUID(), journal_id: journalId, line_no: 1, gl_account_id: debitId, debit_amount: d4(amount), credit_amount: '0.0000', description, nob_id: nobId, lob_id: lobId },
        { line_id: randomUUID(), journal_id: journalId, line_no: 2, gl_account_id: creditId, debit_amount: '0.0000', credit_amount: d4(amount), description, nob_id: nobId, lob_id: lobId },
      ]);
    }

    for (const cfg of [
      { compId: comp1Id, admin: c1Admin, itemMap: itemMap1, glMap: glMap1, ccMap: ccMap1, warehouse: warehouse1, batch: batch1a, tag: 'APX', rawCode: 'RAW-MAIZE-CORN', feedCode: 'FEED-GEST-SOW', medCode: 'MED-IRON-DEX' },
      { compId: comp2Id, admin: c2Admin, itemMap: itemMap2, glMap: glMap2, ccMap: ccMap2, warehouse: warehouse2, batch: batch2a, tag: 'HGH', rawCode: 'RAW-MAIZE-CORN', feedCode: 'FEED-WEAN-GROW', medCode: 'MED-IVERMECTIN' },
    ] as const) {
      await run(`Section 4/5: Inventory + finance (${cfg.tag})`, async () => {
        const existing = await db.select().from(schema.goodsReceipt).where(eq(schema.goodsReceipt.company_id, cfg.compId)).limit(1);
        if (existing.length > 0) {
          console.log('  inventory already seeded for this company, skipping.');
          return;
        }
        const rawItem = cfg.itemMap.get(cfg.rawCode);
        const feedItem = cfg.itemMap.get(cfg.feedCode);
        const medItem = cfg.itemMap.get(cfg.medCode);
        if (!rawItem || !feedItem || !medItem) throw new Error(`Items not found for ${cfg.tag}.`);

        // Second small warehouse so a transfer has a real destination.
        const feedmillCode = `WH-${cfg.tag}-FEEDMILL`;
        const [feedmillWh] = await db.select().from(schema.locationMaster).where(and(eq(schema.locationMaster.company_id, cfg.compId), eq(schema.locationMaster.location_code, feedmillCode))).limit(1);
        let feedmillWhId = feedmillWh?.location_id;
        if (!feedmillWh) {
          // A warehouse is a location of type STORE, parented to the company's
          // farm when it has one. warehouse_master no longer exists.
          const [farmLoc] = await db.select().from(schema.locationMaster)
            .where(and(eq(schema.locationMaster.company_id, cfg.compId), eq(schema.locationMaster.location_type, 'FARM'))).limit(1);
          feedmillWhId = randomUUID();
          await db.insert(schema.locationMaster).values({
            location_id: feedmillWhId,
            tenant_id: tenantId,
            company_id: cfg.compId,
            location_code: (await seriesCodeFor(db, { tenantId, companyId: cfg.compId }, 'LOCATION',
              { parent_location_id: farmLoc?.location_code ?? null, location_type: 'STORE' },
              (await db.select({ code: schema.locationMaster.location_code }).from(schema.locationMaster)
                .where(eq(schema.locationMaster.company_id, cfg.compId))).map((r: { code: string }) => r.code),
            )) ?? feedmillCode,
            location_name: `${cfg.tag} Feed Mill Store`,
            location_level: farmLoc ? 2 : 1,
            location_type: 'STORE',
            parent_location_id: farmLoc?.location_id ?? null,
            farm_id: farmLoc?.location_id ?? null,
            storage_type: 'STORE',
          });
        }

        // --- GRN 1: raw material, 2000 KG @ 22 (or item's standard cost) ---
        const rawRate = Number(rawItem.standard_cost) || 22;
        const rawQty = 2000;
        const grn1Id = randomUUID();
        await db.insert(schema.goodsReceipt).values({
          receipt_id: grn1Id, tenant_id: tenantId, company_id: cfg.compId, receipt_no: `GRN-2026-${cfg.tag}-0001`,
          posting_date: todayMinus(20), warehouse_id: cfg.warehouse.warehouse_id, remarks: 'Bulk maize procurement', status: 'POSTED', posted_at: tsMinus(20), posted_by: cfg.admin.user_id, created_by: cfg.admin.user_id,
        });
        const grn1LineId = randomUUID();
        await db.insert(schema.goodsReceiptLine).values({ line_id: grn1LineId, receipt_id: grn1Id, line_no: 1, item_id: rawItem.item_id, quantity: d4(rawQty), uom: rawItem.uom_primary, rate: rawRate.toFixed(6), amount: d4(rawQty * rawRate) });
        const grn1LedgerId = randomUUID();
        await db.insert(schema.inventoryLedger).values({
          ledger_id: grn1LedgerId, tenant_id: tenantId, company_id: cfg.compId, item_id: rawItem.item_id, item_code: rawItem.item_code, item_description: rawItem.item_name,
          document_type: 'GOODS_RECEIPT', document_no: `GRN-2026-${cfg.tag}-0001`, document_line_id: grn1LineId, posting_date: todayMinus(20), entry_type: 'POSITIVE', transaction_type: 'PURCHASE',
          quantity: d4(rawQty), remaining_quantity: d4(rawQty), uom: rawItem.uom_primary, rate: rawRate.toFixed(6), amount: d4(rawQty * rawRate),
          warehouse_id: cfg.warehouse.warehouse_id, nob_id: nobId, lob_id: lobId, category_id: rawItem.category_id, created_by: cfg.admin.user_id,
        });
        await postJournal(cfg.compId, cfg.glMap, `JV-2026-${cfg.tag}-0001`, todayMinus(20), 'GOODS_RECEIPT', `GRN-2026-${cfg.tag}-0001`, grn1LedgerId, '1010', '2010', rawQty * rawRate, `Maize procurement — ${rawItem.item_name}`, cfg.admin.user_id);

        // --- GRN 2: feed, 1000 KG ---
        const feedRate = Number(feedItem.standard_cost) || 30;
        const feedQty = 1000;
        const grn2Id = randomUUID();
        await db.insert(schema.goodsReceipt).values({
          receipt_id: grn2Id, tenant_id: tenantId, company_id: cfg.compId, receipt_no: `GRN-2026-${cfg.tag}-0002`,
          posting_date: todayMinus(18), warehouse_id: cfg.warehouse.warehouse_id, remarks: 'Compound feed procurement', status: 'POSTED', posted_at: tsMinus(18), posted_by: cfg.admin.user_id, created_by: cfg.admin.user_id,
        });
        const grn2LineId = randomUUID();
        await db.insert(schema.goodsReceiptLine).values({ line_id: grn2LineId, receipt_id: grn2Id, line_no: 1, item_id: feedItem.item_id, quantity: d4(feedQty), uom: feedItem.uom_primary, rate: feedRate.toFixed(6), amount: d4(feedQty * feedRate) });
        const grn2LedgerId = randomUUID();
        await db.insert(schema.inventoryLedger).values({
          ledger_id: grn2LedgerId, tenant_id: tenantId, company_id: cfg.compId, item_id: feedItem.item_id, item_code: feedItem.item_code, item_description: feedItem.item_name,
          document_type: 'GOODS_RECEIPT', document_no: `GRN-2026-${cfg.tag}-0002`, document_line_id: grn2LineId, posting_date: todayMinus(18), entry_type: 'POSITIVE', transaction_type: 'PURCHASE',
          quantity: d4(feedQty), remaining_quantity: d4(feedQty), uom: feedItem.uom_primary, rate: feedRate.toFixed(6), amount: d4(feedQty * feedRate),
          warehouse_id: cfg.warehouse.warehouse_id, nob_id: nobId, lob_id: lobId, category_id: feedItem.category_id, created_by: cfg.admin.user_id,
        });
        await postJournal(cfg.compId, cfg.glMap, `JV-2026-${cfg.tag}-0002`, todayMinus(18), 'GOODS_RECEIPT', `GRN-2026-${cfg.tag}-0002`, grn2LedgerId, '1010', '2010', feedQty * feedRate, `Feed procurement — ${feedItem.item_name}`, cfg.admin.user_id);

        // --- Goods Issue: consume 800 KG of raw material against GRN 1's layer ---
        const issueQty = 800;
        const issueId = randomUUID();
        const costCenterId = cfg.ccMap.get(cfg.tag === 'APX' ? 'CC-FEEDMILL-A' : 'CC-FEEDMILL-H');
        await db.insert(schema.goodsIssue).values({
          issue_id: issueId, tenant_id: tenantId, company_id: cfg.compId, issue_no: `ISS-2026-${cfg.tag}-0001`,
          posting_date: todayMinus(14), warehouse_id: cfg.warehouse.warehouse_id, cost_center_id: costCenterId, remarks: 'Issued to feed mill for ration mixing', status: 'POSTED', posted_at: tsMinus(14), posted_by: cfg.admin.user_id, created_by: cfg.admin.user_id,
        });
        await db.insert(schema.goodsIssueLine).values({ line_id: randomUUID(), issue_id: issueId, line_no: 1, item_id: rawItem.item_id, quantity: d4(issueQty), uom: rawItem.uom_primary });
        const issueLedgerId = randomUUID();
        await db.insert(schema.inventoryLedger).values({
          ledger_id: issueLedgerId, tenant_id: tenantId, company_id: cfg.compId, item_id: rawItem.item_id, item_code: rawItem.item_code, item_description: rawItem.item_name,
          document_type: 'GOODS_ISSUE', document_no: `ISS-2026-${cfg.tag}-0001`, posting_date: todayMinus(14), entry_type: 'NEGATIVE', transaction_type: 'CONSUMPTION',
          quantity: d4(-issueQty), remaining_quantity: '0.0000', uom: rawItem.uom_primary, rate: rawRate.toFixed(6), amount: d4(-issueQty * rawRate),
          warehouse_id: cfg.warehouse.warehouse_id, nob_id: nobId, lob_id: lobId, category_id: rawItem.category_id, created_by: cfg.admin.user_id,
        });
        await db.insert(schema.inventoryApplication).values({
          application_id: randomUUID(), tenant_id: tenantId, company_id: cfg.compId, item_id: rawItem.item_id,
          inbound_ledger_id: grn1LedgerId, outbound_ledger_id: issueLedgerId, applied_qty: d4(issueQty), applied_cost_amount: d4(issueQty * rawRate), application_date: todayMinus(14), created_by: cfg.admin.user_id,
        });
        await db.update(schema.inventoryLedger).set({ remaining_quantity: d4(rawQty - issueQty) }).where(eq(schema.inventoryLedger.ledger_id, grn1LedgerId));
        await postJournal(cfg.compId, cfg.glMap, `JV-2026-${cfg.tag}-0003`, todayMinus(14), 'GOODS_ISSUE', `ISS-2026-${cfg.tag}-0001`, issueLedgerId, '5020', '1010', issueQty * rawRate, `Feed mill issue — ${rawItem.item_name}`, cfg.admin.user_id);

        // --- Stock transfer: 500 KG raw material, main warehouse -> feed mill store ---
        const transferQty = 500;
        const remainingAfterIssue = rawQty - issueQty;
        const stTransferId = randomUUID();
        await db.insert(schema.stockTransfer).values({
          transfer_id: stTransferId, tenant_id: tenantId, company_id: cfg.compId, transfer_no: `TRF-2026-${cfg.tag}-0001`,
          posting_date: todayMinus(10), from_warehouse_id: cfg.warehouse.warehouse_id, to_warehouse_id: feedmillWhId!, remarks: 'Pre-positioning stock at feed mill store', status: 'POSTED', posted_at: tsMinus(10), posted_by: cfg.admin.user_id, created_by: cfg.admin.user_id,
        });
        await db.insert(schema.stockTransferLine).values({ line_id: randomUUID(), transfer_id: stTransferId, line_no: 1, item_id: rawItem.item_id, quantity: d4(transferQty), uom: rawItem.uom_primary });
        const shipLedgerId = randomUUID();
        await db.insert(schema.inventoryLedger).values({
          ledger_id: shipLedgerId, tenant_id: tenantId, company_id: cfg.compId, item_id: rawItem.item_id, item_code: rawItem.item_code, item_description: rawItem.item_name,
          document_type: 'TRANSFER', document_no: `TRF-2026-${cfg.tag}-0001`, posting_date: todayMinus(10), entry_type: 'NEGATIVE', transaction_type: 'TRANSFER_SHIPMENT',
          quantity: d4(-transferQty), remaining_quantity: '0.0000', uom: rawItem.uom_primary, rate: rawRate.toFixed(6), amount: d4(-transferQty * rawRate),
          warehouse_id: cfg.warehouse.warehouse_id, nob_id: nobId, lob_id: lobId, category_id: rawItem.category_id, created_by: cfg.admin.user_id,
        });
        await db.insert(schema.inventoryApplication).values({
          application_id: randomUUID(), tenant_id: tenantId, company_id: cfg.compId, item_id: rawItem.item_id,
          inbound_ledger_id: grn1LedgerId, outbound_ledger_id: shipLedgerId, applied_qty: d4(transferQty), applied_cost_amount: d4(transferQty * rawRate), application_date: todayMinus(10), created_by: cfg.admin.user_id,
        });
        await db.update(schema.inventoryLedger).set({ remaining_quantity: d4(remainingAfterIssue - transferQty) }).where(eq(schema.inventoryLedger.ledger_id, grn1LedgerId));
        const receiveLedgerId = randomUUID();
        await db.insert(schema.inventoryLedger).values({
          ledger_id: receiveLedgerId, tenant_id: tenantId, company_id: cfg.compId, item_id: rawItem.item_id, item_code: rawItem.item_code, item_description: rawItem.item_name,
          document_type: 'TRANSFER', document_no: `TRF-2026-${cfg.tag}-0001`, posting_date: todayMinus(10), entry_type: 'POSITIVE', transaction_type: 'TRANSFER_RECEIPT',
          quantity: d4(transferQty), remaining_quantity: d4(transferQty), uom: rawItem.uom_primary, rate: rawRate.toFixed(6), amount: d4(transferQty * rawRate),
          warehouse_id: feedmillWhId, nob_id: nobId, lob_id: lobId, category_id: rawItem.category_id, created_by: cfg.admin.user_id,
        });
        await postJournal(cfg.compId, cfg.glMap, `JV-2026-${cfg.tag}-0004`, todayMinus(10), 'TRANSFER', `TRF-2026-${cfg.tag}-0001`, shipLedgerId, '1040', '1010', transferQty * rawRate, 'In-transit transfer to feed mill store', cfg.admin.user_id);

        // --- Stock adjustment: small positive correction on medicine stock ---
        const medRate = Number(medItem.standard_cost) || 200;
        const adjQty = 5;
        const adjId = randomUUID();
        await db.insert(schema.stockAdjustment).values({
          adjustment_id: adjId, tenant_id: tenantId, company_id: cfg.compId, adjustment_no: `ADJ-2026-${cfg.tag}-0001`,
          posting_date: todayMinus(7), warehouse_id: cfg.warehouse.warehouse_id, reason: 'Physical count variance — found unrecorded stock', status: 'POSTED', posted_at: tsMinus(7), posted_by: cfg.admin.user_id, created_by: cfg.admin.user_id,
        });
        await db.insert(schema.stockAdjustmentLine).values({ line_id: randomUUID(), adjustment_id: adjId, line_no: 1, item_id: medItem.item_id, quantity: d4(adjQty), uom: medItem.uom_primary, rate: medRate.toFixed(6) });
        const adjLedgerId = randomUUID();
        await db.insert(schema.inventoryLedger).values({
          ledger_id: adjLedgerId, tenant_id: tenantId, company_id: cfg.compId, item_id: medItem.item_id, item_code: medItem.item_code, item_description: medItem.item_name,
          document_type: 'ADJUSTMENT', document_no: `ADJ-2026-${cfg.tag}-0001`, posting_date: todayMinus(7), entry_type: 'POSITIVE', transaction_type: 'VARIANCE_POSITIVE',
          quantity: d4(adjQty), remaining_quantity: d4(adjQty), uom: medItem.uom_primary, rate: medRate.toFixed(6), amount: d4(adjQty * medRate),
          warehouse_id: cfg.warehouse.warehouse_id, nob_id: nobId, lob_id: lobId, category_id: medItem.category_id, created_by: cfg.admin.user_id,
        });
        await postJournal(cfg.compId, cfg.glMap, `JV-2026-${cfg.tag}-0005`, todayMinus(7), 'ADJUSTMENT', `ADJ-2026-${cfg.tag}-0001`, adjLedgerId, '1010', '4030', adjQty * medRate, `Physical count variance — ${medItem.item_name}`, cfg.admin.user_id);

        console.log('  2 GRNs, 1 issue (FIFO-applied), 1 transfer (FIFO-applied), 1 adjustment, 5 journals posted.');
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 6 & 7. QC + QR traceability
    // ═══════════════════════════════════════════════════════════════════
    for (const cfg of [
      { compId: comp1Id, admin: c1Admin, batch: batch1a!, warehouse: warehouse1, itemMap: itemMap1, tag: 'APX', bioCode: 'BIO-SWINE-SOW', breed: 'Yorkshire' },
      { compId: comp2Id, admin: c2Admin, batch: batch2b!, warehouse: warehouse2, itemMap: itemMap2, tag: 'HGH', bioCode: 'LVS-DRESSED-PORK', breed: 'Duroc' },
    ] as const) {
      await run(`Section 6/7: QC + QR (${cfg.tag})`, async () => {
        const existing = await db.select().from(schema.qcBatchDetail).where(eq(schema.qcBatchDetail.company_id, cfg.compId)).limit(1);
        if (existing.length > 0) {
          console.log('  QC/QR already seeded for this company, skipping.');
          return;
        }

        const [param] = await db.select().from(schema.qcParameterMaster).where(and(eq(schema.qcParameterMaster.lob_id, lobId))).limit(1);
        let paramId = param?.param_id;
        let param2Id: string | undefined;
        if (!param) {
          paramId = randomUUID();
          await db.insert(schema.qcParameterMaster).values({
            param_id: paramId, tenant_id: tenantId, company_id: null, lob_id: lobId, param_code: 'QC-CARCASS-WT', param_name: 'Carcass Weight', param_type: 'NUMERIC', uom: 'KG', min_value: '60.0000', max_value: '110.0000', pass_criteria: 'Within range', fail_criteria: 'Below 60kg or above 110kg', is_mandatory: true, is_active: true, created_by: cfg.admin.user_id,
          });
          param2Id = randomUUID();
          await db.insert(schema.qcParameterMaster).values({
            param_id: param2Id, tenant_id: tenantId, company_id: null, lob_id: lobId, param_code: 'QC-VISUAL-GRADE', param_name: 'Visual Grade', param_type: 'GRADE', grade_scale: { A: 'Premium', B: 'Standard', C: 'Economy' }, is_mandatory: false, is_active: true, created_by: cfg.admin.user_id,
          });
        }

        const qc1Id = randomUUID();
        await db.insert(schema.qcBatchDetail).values({
          qc_id: qc1Id, tenant_id: tenantId, company_id: cfg.compId, source_batch_id: cfg.batch.batch_id, qc_date: todayMinus(3), inspector_id: cfg.admin.user_id,
          total_qty_received: '20.0000', pass_qty: '18.0000', fail_qty: '1.0000', hold_qty: '1.0000', grade_a_qty: '12.0000', grade_b_qty: '6.0000', grade_c_qty: '2.0000',
          overall_result: 'PASS', disposition: 'ACCEPT', qc_notes: 'Routine batch inspection — within tolerance.', created_by: cfg.admin.user_id,
        });
        await db.insert(schema.qcParamResult).values({ result_id: randomUUID(), qc_id: qc1Id, param_id: paramId!, actual_value: '92.5', result_status: 'PASS', grade_assigned: 'A' });

        const qc2Id = randomUUID();
        await db.insert(schema.qcBatchDetail).values({
          qc_id: qc2Id, tenant_id: tenantId, company_id: cfg.compId, source_batch_id: cfg.batch.batch_id, qc_date: todayMinus(1), inspector_id: cfg.admin.user_id,
          total_qty_received: '8.0000', pass_qty: '5.0000', fail_qty: '3.0000', hold_qty: '0.0000', grade_a_qty: '2.0000', grade_b_qty: '3.0000', grade_c_qty: '3.0000',
          overall_result: 'CONDITIONAL', disposition: 'REWORK', qc_notes: 'Weight variance above threshold on 3 units — sent for rework/regrading.', created_by: cfg.admin.user_id,
        });
        await db.insert(schema.qcParamResult).values({ result_id: randomUUID(), qc_id: qc2Id, param_id: paramId!, actual_value: '58.0', result_status: 'FAIL' });

        const bioItem = cfg.itemMap.get(cfg.bioCode) || Array.from(cfg.itemMap.values())[0];
        const qrId = randomUUID();
        const packNo = 'PACK-000001';
        await db.insert(schema.qrCodeMaster).values({
          qr_id: qrId, tenant_id: tenantId, company_id: cfg.compId, batch_id: cfg.batch.batch_id, qc_id: qc1Id, item_id: bioItem.item_id,
          lot_no: `LOT-${cfg.tag}-2026-08`, pack_no: packNo, production_date: todayMinus(3), expiry_date: todayMinus(-90), net_weight: '92.5000', gross_weight: '95.0000', pack_uom: 'KG',
          warehouse_id: cfg.warehouse.warehouse_id, grade: 'A', breed: cfg.breed, generated_by: cfg.admin.user_id,
          qr_data: {
            pack_no: packNo, item_code: bioItem.item_code, item_name: bioItem.item_name, lot_no: `LOT-${cfg.tag}-2026-08`, batch_no: cfg.batch.batch_no,
            net_weight: '92.5000', gross_weight: '95.0000', pack_uom: 'KG', production_date: todayMinus(3), expiry_date: todayMinus(-90),
            facility_code: cfg.tag, breed: cfg.breed, grade: 'A', origin_batch_chain: [{ batch_no: cfg.batch.batch_no }],
            qc: { qc_id: qc1Id, overall_result: 'PASS', disposition: 'ACCEPT', qc_date: todayMinus(3) },
          },
        });
        console.log('  2 QC inspections + 1 QR pack code seeded.');
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 8. Notifications (in-app alerts)
    // ═══════════════════════════════════════════════════════════════════
    for (const [compId, batch, tag] of [[comp1Id, batch1a, 'APX'], [comp2Id, batch2a, 'HGH']] as const) {
      await run(`Section 8: Notifications (${tag})`, async () => {
        const existing = await db.select().from(schema.notificationAlertLog).where(eq(schema.notificationAlertLog.company_id, compId)).limit(1);
        if (existing.length > 0) {
          console.log('  already seeded, skipping.');
          return;
        }
        const alerts = [
          { severity: 'WARNING', title: 'Feed consumption above KPI band', message: `Batch ${batch!.batch_no}: daily feed consumption exceeded the scheduled band by 12%.`, param: 'Feed Consumption', expected: '2.20', actual: '2.47', devPct: '12.27', isRead: true, daysAgo: 6 },
          { severity: 'CRITICAL', title: 'Mortality spike detected', message: `Batch ${batch!.batch_no}: mortality rate crossed the critical threshold for the past 3 days.`, param: 'Mortality Rate', expected: '0.50', actual: '1.80', devPct: '260.00', isRead: false, daysAgo: 2 },
          { severity: 'WARNING', title: 'Water intake below expected range', message: `Batch ${batch!.batch_no}: water intake trending below the expected daily range.`, param: 'Water Intake', expected: '15.00', actual: '11.20', devPct: '-25.33', isRead: false, daysAgo: 1 },
        ];
        for (const a of alerts) {
          await db.insert(schema.notificationAlertLog).values({
            alert_id: randomUUID(), tenant_id: tenantId, company_id: compId, lob_id: lobId, batch_id: batch!.batch_id,
            alert_type: 'KPI_DEVIATION', severity: a.severity, title: a.title, message: a.message, activity_name: a.param,
            kpi_mode: 'BAND', expected_value: a.expected, actual_value: a.actual, deviation_pct: a.devPct,
            is_read: a.isRead, read_at: a.isRead ? tsMinus(a.daysAgo - 1) : null, created_at: tsMinus(a.daysAgo),
          });
        }
        console.log(`  ${alerts.length} alerts seeded.`);
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 9. Approvals
    // ═══════════════════════════════════════════════════════════════════
    for (const cfg of [
      { compId: comp1Id, admin: c1Admin, areaId: area1.area_id, batch: batch1a!, tag: 'APX' },
      { compId: comp2Id, admin: c2Admin, areaId: (area2 ?? area1).area_id, batch: batch2a!, tag: 'HGH' },
    ] as const) {
      await run(`Section 9: Approvals (${cfg.tag})`, async () => {
        const existing = await db.select().from(schema.approvalRequest).where(eq(schema.approvalRequest.company_id, cfg.compId)).limit(1);
        if (existing.length > 0) {
          console.log('  already seeded, skipping.');
          return;
        }
        const reqs = [
          { doc_type: 'FEED_RATION', doc_no: `REQ-RAT-2026-${cfg.tag}-0001`, title: 'Increase gestation ration by 5%', urgency: 'MEDIUM', status: 'PENDING', qty: '2.31', uom: 'KG', cost: '5040.00', justification: 'Body condition scoring indicates under-conditioned sows this cycle.' },
          { doc_type: 'GRN_RECEIPT', doc_no: `REQ-GRN-2026-${cfg.tag}-0001`, title: 'Approve emergency feed procurement', urgency: 'HIGH', status: 'APPROVED', qty: '1000', uom: 'KG', cost: '31000.00', justification: 'Stock projected to run out before next scheduled delivery.' },
          { doc_type: 'STOCK_TRANSFER', doc_no: `REQ-TRF-2026-${cfg.tag}-0001`, title: 'Transfer surplus feed to feed mill store', urgency: 'LOW', status: 'REJECTED', qty: '500', uom: 'KG', cost: '11000.00', justification: 'Requested to consolidate stock ahead of audit.', rejectReason: 'Feed mill store already at capacity — hold until next cycle.' },
        ];
        let i = 0;
        for (const r of reqs) {
          i++;
          const decided = r.status !== 'PENDING';
          await db.insert(schema.approvalRequest).values({
            request_id: randomUUID(), tenant_id: tenantId, company_id: cfg.compId, operational_area_id: cfg.areaId,
            doc_type: r.doc_type, doc_no: r.doc_no, title: r.title, requested_by: cfg.admin.user_id, requestor_label: cfg.admin.full_name, requestor_role: 'Company Admin',
            location_label: cfg.batch.batch_no, batch_id: cfg.batch.batch_id, urgency: r.urgency, item_or_stage: r.title, requested_qty: r.qty, uom: r.uom, cost_impact: r.cost,
            justification: r.justification, status: r.status, submitted_at: tsMinus(8 - i), decided_at: decided ? tsMinus(6 - i) : null, decided_by: decided ? cfg.admin.user_id : null,
            decider_label: decided ? cfg.admin.full_name : null, rejection_reason: (r as any).rejectReason || null, created_by: cfg.admin.user_id,
          });
        }
        console.log(`  ${reqs.length} approval requests seeded (pending/approved/rejected).`);
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // 10. Audit log
    // ═══════════════════════════════════════════════════════════════════
    for (const cfg of [{ compId: comp1Id, admin: c1Admin, batch: batch1a!, tag: 'APX' }, { compId: comp2Id, admin: c2Admin, batch: batch2a!, tag: 'HGH' }] as const) {
      await run(`Section 10: Audit log (${cfg.tag})`, async () => {
        const existing = await db.select().from(schema.auditLog).where(eq(schema.auditLog.company_id, cfg.compId)).limit(1);
        if (existing.length > 0) {
          console.log('  already seeded, skipping.');
          return;
        }
        const entries: { action: string; entity: string; entityId: string; daysAgo: number; newValues?: any }[] = [
          { action: 'CREATE', entity: 'batch_header', entityId: cfg.batch.batch_id, daysAgo: 20, newValues: { batch_no: cfg.batch.batch_no, status: 'ACTIVE' } },
          { action: 'CREATE', entity: 'goods_receipt', entityId: cfg.batch.batch_id, daysAgo: 20 },
          { action: 'CREATE', entity: 'goods_receipt', entityId: cfg.batch.batch_id, daysAgo: 18 },
          { action: 'CREATE', entity: 'goods_issue', entityId: cfg.batch.batch_id, daysAgo: 14 },
          { action: 'CREATE', entity: 'stock_transfer', entityId: cfg.batch.batch_id, daysAgo: 10 },
          { action: 'CREATE', entity: 'stock_adjustment', entityId: cfg.batch.batch_id, daysAgo: 7 },
          { action: 'UPDATE', entity: 'batch_transfer', entityId: cfg.batch.batch_id, daysAgo: 5 },
          { action: 'CREATE', entity: 'qc_batch_detail', entityId: cfg.batch.batch_id, daysAgo: 3 },
          { action: 'CREATE', entity: 'qr_code_master', entityId: cfg.batch.batch_id, daysAgo: 3 },
          { action: 'APPROVE', entity: 'approval_request', entityId: cfg.batch.batch_id, daysAgo: 2 },
          { action: 'REJECT', entity: 'approval_request', entityId: cfg.batch.batch_id, daysAgo: 2 },
          { action: 'LOGIN', entity: 'user_master', entityId: cfg.admin.user_id, daysAgo: 1 },
        ];
        for (const e of entries) {
          await db.insert(schema.auditLog).values({
            audit_id: randomUUID(), tenant_id: tenantId, company_id: cfg.compId, user_id: cfg.admin.user_id,
            action: e.action, entity_name: e.entity, entity_id: e.entityId, new_values: e.newValues || null, created_at: tsMinus(e.daysAgo),
          });
        }
        console.log(`  ${entries.length} audit entries seeded.`);
      });
    }

    console.log('\n🎉 Full-coverage demo data seed complete.');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void seedFullCoverage().catch((err) => {
    console.error('❌ Full-coverage seed failed:', err);
    process.exitCode = 1;
  });
}
