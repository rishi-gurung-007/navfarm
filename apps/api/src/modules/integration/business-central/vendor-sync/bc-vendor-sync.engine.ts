import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../../core/database/schema';
import type { BusinessCentralConfig } from '../business-central.config';
import { BcApiError } from '../bc-errors';
import { type BcODataClient, odataString } from '../bc-odata.client';
import { BC_VENDOR_SELECT, type BcVendorCard, type SupplierFromBc } from './bc-vendor.mapper';
import { type ExistingSupplier, planVendorSync, type VendorAction, type VendorSyncPlan } from './bc-vendor-sync.planner';

type Db = MySql2Database<typeof schema>;

export type SyncTrigger = 'MANUAL' | 'SCHEDULED' | 'SCRIPT' | 'AUTO'; // AUTO = Suppliers screen opened with a stale list

export interface VendorSyncContext {
  tenantId: string;
  companyId: string;
  userId?: string | null;
  trigger: SyncTrigger;
}

export interface VendorSyncResult {
  logId: string | null;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'PREVIEW';
  scope: 'FLAGGED' | 'ALL';
  plan: VendorSyncPlan;
  writtenBack: number;
  writeBackErrors: Array<{ vendorNo: string; error: string }>;
  error: string | null;
}

const ts = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' ');

/** Reads the vendors in scope from the BC web service. */
export async function fetchBcVendors(client: BcODataClient, config: BusinessCentralConfig): Promise<BcVendorCard[]> {
  if (!config.companyName) throw new BcApiError('NOT_CONFIGURED', 'BC_COMPANY_NAME is not set (ODataV4 web services address the company by name).');
  return client.getAll<BcVendorCard>(config.vendor.service, {
    endpoint: { kind: 'odataV4' },
    companyName: config.companyName,
    query: {
      select: [...BC_VENDOR_SELECT],
      filter: config.vendor.scope === 'FLAGGED' ? 'NavFarm_Sync eq true' : undefined,
      orderBy: 'No',
    },
  });
}

export async function loadExistingSuppliers(db: Db, tenantId: string, companyId: string): Promise<ExistingSupplier[]> {
  const s = schema.supplierMaster;
  const rows = await db
    .select({
      supplier_id: s.supplier_id,
      supplier_code: s.supplier_code,
      source_system: s.source_system,
      bc_vendor_no: s.bc_vendor_no,
      bc_etag: s.bc_etag,
      deleted_at: s.deleted_at,
      supplier_name: s.supplier_name,
      bc_name_2: s.bc_name_2,
      address_line1: s.address_line1,
      city: s.city,
      state: s.state,
      country: s.country,
      pincode: s.pincode,
      phone: s.phone,
      email: s.email,
      tax_number: s.tax_number,
      registration_number: s.registration_number,
      payment_terms: s.payment_terms,
      currency_code: s.currency_code,
      gen_bus_posting_group: s.gen_bus_posting_group,
      vendor_posting_group: s.vendor_posting_group,
      contact_name: s.contact_name,
      purchaser_code: s.purchaser_code,
      bc_blocked: s.bc_blocked,
      is_active: s.is_active,
    })
    .from(s)
    .where(and(eq(s.tenant_id, tenantId), eq(s.company_id, companyId)));
  return rows as ExistingSupplier[];
}

/** Writes the plan into supplier_master. Call inside a transaction; returns nothing it did not write. */
export async function applyVendorPlan(db: Db, plan: VendorSyncPlan, ctx: VendorSyncContext, now = new Date()): Promise<void> {
  const s = schema.supplierMaster;
  const stamp = ts(now);
  for (const action of plan.actions) {
    switch (action.type) {
      case 'CREATE': {
        const v = action.supplier;
        await db.insert(s).values({
          supplier_id: randomUUID(),
          tenant_id: ctx.tenantId,
          company_id: ctx.companyId,
          ...bcColumns(v),
          supplier_code: v.supplier_code,
          bc_vendor_no: v.bc_vendor_no,
          source_system: 'BC',
          vendor_type: 'GENERAL',
          // A vendor exists in BC only after Finance created it there; NAVFarm's own approval step does not apply.
          is_approved: true,
          approved_at: stamp as any,
          status: v.is_active ? 'ACTIVE' : 'INACTIVE',
          bc_synced_at: stamp as any,
          bc_sync_error: null,
          created_by: ctx.userId ?? null,
          updated_by: ctx.userId ?? null,
        });
        break;
      }
      case 'UPDATE': {
        const v = action.supplier;
        await db
          .update(s)
          .set({
            ...bcColumns(v),
            bc_vendor_no: v.bc_vendor_no,
            source_system: 'BC',
            status: v.is_active ? 'ACTIVE' : 'INACTIVE',
            is_approved: true,
            bc_synced_at: stamp as any,
            bc_sync_error: null,
            updated_by: ctx.userId ?? null,
            updated_at: stamp,
            ...(action.restore ? { deleted_at: null } : {}),
          })
          .where(eq(s.supplier_id, action.supplierId));
        break;
      }
      case 'UNCHANGED': {
        if (!action.etagChanged) break;
        await db
          .update(s)
          .set({ bc_etag: action.supplier.bc_etag, bc_last_modified_date: action.supplier.bc_last_modified_date, bc_synced_at: stamp as any, bc_sync_error: null })
          .where(eq(s.supplier_id, action.supplierId));
        break;
      }
      case 'DEACTIVATE': {
        await db
          .update(s)
          .set({ is_active: false, status: 'INACTIVE', bc_sync_error: action.reason.slice(0, 250), bc_synced_at: stamp as any, updated_at: stamp })
          .where(eq(s.supplier_id, action.supplierId));
        break;
      }
      case 'FAILED': {
        if (!action.vendorNo) break;
        await db
          .update(s)
          .set({ bc_sync_error: action.reason.slice(0, 250) })
          .where(and(eq(s.tenant_id, ctx.tenantId), eq(s.company_id, ctx.companyId), eq(s.bc_vendor_no, action.vendorNo)));
        break;
      }
    }
  }
}

function bcColumns(v: SupplierFromBc) {
  return {
    supplier_name: v.supplier_name,
    bc_name_2: v.bc_name_2,
    address_line1: v.address_line1,
    city: v.city,
    state: v.state,
    country: v.country,
    pincode: v.pincode,
    phone: v.phone,
    email: v.email,
    tax_number: v.tax_number,
    registration_number: v.registration_number,
    payment_terms: v.payment_terms,
    currency_code: v.currency_code,
    gen_bus_posting_group: v.gen_bus_posting_group,
    vendor_posting_group: v.vendor_posting_group,
    contact_name: v.contact_name,
    purchaser_code: v.purchaser_code,
    bc_blocked: v.bc_blocked,
    is_active: v.is_active,
    bc_etag: v.bc_etag,
    bc_last_modified_date: v.bc_last_modified_date,
  };
}

/** Desired BC sync-status fields for one vendor; null when BC already shows exactly that. */
export function writeBackPatch(
  action: VendorAction,
  vendor: BcVendorCard | undefined,
  config: BusinessCentralConfig['vendor'],
): Record<string, unknown> | null {
  if (!vendor || action.type === 'DEACTIVATE') return null;
  const failed = action.type === 'FAILED';
  const message = failed ? action.reason.slice(0, 250) : '';
  const wanted: Record<string, unknown> = { Navfarm_Sync_Error: failed, Navfarm_Error_Message: message };
  const status = failed ? config.syncStatusError : config.syncStatusSynced;
  if (status) wanted.Sync_Status = status;
  const current: Record<string, unknown> = {
    Navfarm_Sync_Error: !!vendor.Navfarm_Sync_Error,
    Navfarm_Error_Message: vendor.Navfarm_Error_Message ?? '',
    Sync_Status: vendor.Sync_Status ?? '',
  };
  const patch: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(wanted)) if (current[k] !== value) patch[k] = value;
  return Object.keys(patch).length ? patch : null;
}

/** PATCHes the sync result onto each BC vendor (If-Match ETag) and stores BC's new ETag on the supplier. */
export async function writeBackToBc(
  db: Db,
  client: BcODataClient,
  config: BusinessCentralConfig,
  plan: VendorSyncPlan,
  vendors: BcVendorCard[],
  ctx: VendorSyncContext,
): Promise<{ written: number; errors: Array<{ vendorNo: string; error: string }> }> {
  const byNo = new Map(vendors.map((v) => [String(v.No).toUpperCase(), v]));
  let written = 0;
  const errors: Array<{ vendorNo: string; error: string }> = [];
  for (const action of plan.actions) {
    const vendor = byNo.get(action.vendorNo.toUpperCase());
    const patch = writeBackPatch(action, vendor, config.vendor);
    if (!patch || !vendor?.['@odata.etag']) continue;
    try {
      const key = `${config.vendor.service}(${encodeURIComponent(odataString(vendor.No))})`;
      const updated = await client.patch<BcVendorCard>(key, patch, vendor['@odata.etag'], {
        endpoint: { kind: 'odataV4' },
        companyName: config.companyName,
        headers: { Prefer: 'return=representation' },
      });
      written++;
      // BC gave the vendor a new ETag; remember it, or the next run would see our own write as a change.
      const etag = updated?.['@odata.etag'];
      if (etag && action.type !== 'FAILED') {
        await db
          .update(schema.supplierMaster)
          .set({ bc_etag: etag.slice(0, 100) })
          .where(and(eq(schema.supplierMaster.tenant_id, ctx.tenantId), eq(schema.supplierMaster.company_id, ctx.companyId), eq(schema.supplierMaster.bc_vendor_no, vendor.No)));
      }
    } catch (error) {
      errors.push({ vendorNo: action.vendorNo, error: (error as Error).message.slice(0, 300) });
    }
  }
  return { written, errors };
}

export async function startSyncLog(db: Db, ctx: VendorSyncContext): Promise<string> {
  const logId = randomUUID();
  await db.insert(schema.integrationSyncLog).values({
    log_id: logId,
    tenant_id: ctx.tenantId,
    company_id: ctx.companyId,
    external_system: 'BC',
    entity: 'VENDOR',
    sync_trigger: ctx.trigger,
    status: 'RUNNING',
    triggered_by: ctx.userId ?? null,
  });
  return logId;
}

export async function finishSyncLog(db: Db, logId: string, result: Omit<VendorSyncResult, 'logId'>): Promise<void> {
  const failures = result.plan.actions
    .filter((a): a is Extract<VendorAction, { type: 'FAILED' }> => a.type === 'FAILED')
    .map((a) => ({ vendorNo: a.vendorNo, reason: a.reason }));
  const changed = result.plan.actions
    .filter((a) => a.type === 'CREATE' || a.type === 'UPDATE' || a.type === 'DEACTIVATE')
    .map((a) => ({ vendorNo: a.vendorNo, action: a.type, fields: a.type === 'UPDATE' ? a.changes.map((c) => c.field) : undefined }));
  await db
    .update(schema.integrationSyncLog)
    .set({
      status: result.status === 'PREVIEW' ? 'SUCCESS' : result.status,
      finished_at: sql`now()` as any,
      fetched_count: result.plan.fetched,
      created_count: result.plan.counts.create,
      updated_count: result.plan.counts.update,
      unchanged_count: result.plan.counts.unchanged,
      deactivated_count: result.plan.counts.deactivate,
      failed_count: result.plan.counts.failed,
      written_back_count: result.writtenBack,
      error_message: result.error ? result.error.slice(0, 1000) : null,
      details: { scope: result.scope, failures, changed: changed.slice(0, 500), writeBackErrors: result.writeBackErrors },
    })
    .where(eq(schema.integrationSyncLog.log_id, logId));
}

export { planVendorSync };
