/**
 * Back-fill (Rishi, 14 Oct): an animal registered against a GRN now takes one animal out of that GRN's stock
 * (ANIMAL_REGISTRATION: Dr Biological Assets / Cr Inventory). Animals registered before then never did, so their GRN
 * still shows them in stock. This gives each such animal its stock-out, through the same ledger and GL services a new
 * registration uses, one transaction per animal:
 *
 *   - drawn from the animal's own GRN layer (the first line of its item that still holds one), dated its entry date;
 *   - skipped when the animal already has its ANIMAL_REGISTRATION entry, so a second run changes nothing;
 *   - reported, not forced, when the GRN has nothing left or the posting period is closed.
 *
 *   pnpm nx run api:db-backfill-animal-grn-stock                      # every active tenant, print what it would do
 *   pnpm nx run api:db-backfill-animal-grn-stock -- --apply           # write it
 *   pnpm nx run api:db-backfill-animal-grn-stock -- --tenant=ppl ...  # one tenant (by code)
 */
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { NestFactory } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { AppModule } from '../app.module';
import { MASTER_CONNECTION } from '../core/database/database.module';
import { ConnectionManagerService } from '../core/database/connection-manager.service';
import * as masterSchema from '../core/database/master-schema';
import * as schema from '../core/database/schema';
import { InventoryLedgerService } from '../modules/inventory/inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../modules/finance/journal/gl-posting.service';
import { withTenantTransaction } from '../common/tenant-transaction';
import type { MySql2Database } from 'drizzle-orm/mysql2';

async function main() {
  const apply = process.argv.includes('--apply');
  const only = process.argv.find((a) => a.startsWith('--tenant='))?.slice('--tenant='.length);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const masterDb = app.get<MySql2Database<typeof masterSchema>>(MASTER_CONNECTION);
    const tenants = (await masterDb.select().from(masterSchema.tenantMaster).where(eq(masterSchema.tenantMaster.is_active, true)))
      .filter((t) => !only || t.tenant_code === only);
    if (!tenants.length) throw new Error(only ? `Tenant '${only}' not found or inactive.` : 'No active tenants.');

    const cls = app.get(ClsService);
    const ledger = app.get(InventoryLedgerService);
    const gl = app.get(GlPostingService);
    let total = 0;
    let done = 0;

    for (const tenant of tenants) {
      let tenantDb: MySql2Database<typeof schema>;
      try {
        tenantDb = await app.get(ConnectionManagerService).getTenantConnection(tenant);
      } catch (e) {
        console.log(`[${tenant.tenant_code}] no database connection — skipped (${(e as Error).message})`);
        continue;
      }
      const A = schema.animalRegister;
      const animals = await tenantDb
        .select({ animal_id: A.animal_id, animal_code: A.animal_code, company_id: A.company_id, item_id: A.item_id, receipt_id: A.source_receipt_id, entry_date: A.entry_date, created_by: A.created_by })
        .from(A)
        .where(isNotNull(A.source_receipt_id))
        .orderBy(asc(A.entry_date), asc(A.animal_code));
      const issued = new Set((await tenantDb
        .select({ id: schema.inventoryLedger.document_line_id })
        .from(schema.inventoryLedger)
        .where(eq(schema.inventoryLedger.transaction_type, 'ANIMAL_REGISTRATION'))).map((r) => r.id));
      const owed = animals.filter((a) => !issued.has(a.animal_id));
      console.log(`[${tenant.tenant_code}] ${animals.length} animal(s) from a GRN, ${owed.length} without their stock-out`);
      total += owed.length;

      for (const a of owed) {
        await cls.run(async () => {
          cls.set('tenantId', tenant.tenant_id);
          cls.set('tenantDb', tenantDb);
          const L = schema.inventoryLedger;
          const layers = await tenantDb
            .select({ ledger_id: L.ledger_id, remaining: L.remaining_quantity, uom: L.uom, warehouse_id: L.warehouse_id, lot_no: L.lot_no, serial_no: L.serial_no, receipt_no: schema.goodsReceipt.receipt_no })
            .from(schema.goodsReceiptLine)
            .innerJoin(schema.goodsReceipt, eq(schema.goodsReceipt.receipt_id, schema.goodsReceiptLine.receipt_id))
            .innerJoin(L, and(eq(L.document_line_id, schema.goodsReceiptLine.line_id), eq(L.document_type, 'GOODS_RECEIPT'), eq(L.entry_type, 'POSITIVE')))
            .where(and(eq(schema.goodsReceiptLine.receipt_id, a.receipt_id!), eq(schema.goodsReceiptLine.item_id, a.item_id)))
            .orderBy(asc(schema.goodsReceiptLine.line_no));
          const layer = layers.find((l) => Number(l.remaining) >= 1);
          const grn = layers[0]?.receipt_no ?? a.receipt_id;
          if (!layer) {
            console.log(`  ${a.animal_code}: GRN ${grn} has no animal of its item left in stock — NOT written`);
            return;
          }
          console.log(`  ${a.animal_code}: 1 out of GRN ${layer.receipt_no} (left before: ${Number(layer.remaining)}), dated ${a.entry_date}`);
          if (!apply) return;
          try {
            await withTenantTransaction(cls, async () => {
              const entry = await ledger.writeNegativeEntry({
                tenantId: tenant.tenant_id,
                companyId: a.company_id,
                itemId: a.item_id,
                documentType: 'ANIMAL_REGISTRATION',
                documentNo: a.animal_code,
                documentLineId: a.animal_id,
                postingDate: a.entry_date,
                transactionType: 'ANIMAL_REGISTRATION',
                quantity: 1,
                uom: layer.uom,
                sourceLedgerId: layer.ledger_id,
                warehouseId: layer.warehouse_id ?? undefined,
                lotNo: layer.lot_no ?? undefined,
                serialNo: layer.serial_no ?? undefined,
                userId: a.created_by ?? undefined,
              });
              await gl.postInventoryLedgerEntry(entry, a.created_by ?? undefined);
            });
            done++;
          } catch (e) {
            console.log(`  ${a.animal_code}: NOT written — ${(e as Error).message}`);
          }
        });
      }
    }
    console.log(apply ? `\nWrote ${done} of ${total} stock-out(s).` : `\nDry run: ${total} stock-out(s) owed. Run with --apply to write them.`);
  } finally {
    await app.close();
  }
}

// The app context keeps timers (schedulers, queues) alive after close; the run is over, so leave.
main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
