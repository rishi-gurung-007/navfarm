import { BC_OWNED_SUPPLIER_FIELDS, type BcVendorCard, mapBcVendor, type SupplierFromBc } from './bc-vendor.mapper';

/** The part of a supplier_master row the planner needs. */
export interface ExistingSupplier {
  supplier_id: string;
  supplier_code: string;
  source_system: string;
  bc_vendor_no: string | null;
  bc_etag: string | null;
  deleted_at: string | null;
  supplier_name: string;
  bc_name_2: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  tax_number: string | null;
  registration_number: string | null;
  payment_terms: string | null;
  currency_code: string | null;
  gen_bus_posting_group: string | null;
  vendor_posting_group: string | null;
  contact_name: string | null;
  purchaser_code: string | null;
  bc_blocked: string | null;
  is_active: boolean;
}

export type FieldChange = { field: string; from: unknown; to: unknown };

export type VendorAction =
  | { type: 'CREATE'; vendorNo: string; supplier: SupplierFromBc }
  | { type: 'UPDATE'; vendorNo: string; supplierId: string; supplier: SupplierFromBc; changes: FieldChange[]; linkExisting: boolean; restore: boolean }
  /** Nothing NAVFarm uses changed; only the stored ETag/date move forward. */
  | { type: 'UNCHANGED'; vendorNo: string; supplierId: string; supplier: SupplierFromBc; etagChanged: boolean }
  | { type: 'DEACTIVATE'; vendorNo: string; supplierId: string; reason: string }
  | { type: 'FAILED'; vendorNo: string; reason: string; vendor?: BcVendorCard };

export interface VendorSyncPlan {
  fetched: number;
  actions: VendorAction[];
  counts: { create: number; update: number; unchanged: number; deactivate: number; failed: number };
  /** Set when the plan was refused as a whole (e.g. it would deactivate too many suppliers). */
  blockedReason: string | null;
}

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/**
 * Decides what one sync run does. Pure: no database, no HTTP — the service applies the plan, the preview shows it.
 *
 * Matching: a BC vendor is matched to a supplier by bc_vendor_no; failing that, to a NAVFarm-created supplier whose
 * code equals the vendor no. (that supplier is then linked and becomes BC-sourced).
 *
 * Deactivation: a BC-sourced supplier whose vendor is no longer in the synced set (NavFarm Sync unticked, or the
 * vendor deleted in BC) is deactivated, never deleted — GRNs and requisitions keep pointing at it.
 */
export function planVendorSync(
  vendors: BcVendorCard[],
  existing: ExistingSupplier[],
  options: { maxDeactivateRatio: number } = { maxDeactivateRatio: 0.5 },
): VendorSyncPlan {
  const actions: VendorAction[] = [];
  const byVendorNo = new Map<string, ExistingSupplier>();
  const byCode = new Map<string, ExistingSupplier>();
  for (const row of existing) {
    if (row.bc_vendor_no) byVendorNo.set(row.bc_vendor_no.toUpperCase(), row);
    byCode.set(row.supplier_code.toUpperCase(), row);
  }

  const seen = new Set<string>();
  for (const vendor of vendors) {
    const mapped = mapBcVendor(vendor);
    if (!mapped.ok) {
      actions.push({ type: 'FAILED', vendorNo: mapped.vendorNo, reason: mapped.reason, vendor });
      continue;
    }
    const s = mapped.supplier;
    const key = s.bc_vendor_no.toUpperCase();
    if (seen.has(key)) {
      actions.push({ type: 'FAILED', vendorNo: s.bc_vendor_no, reason: 'Vendor No. returned twice by Business Central.', vendor });
      continue;
    }
    seen.add(key);

    let row = byVendorNo.get(key);
    let linkExisting = false;
    if (!row) {
      const sameCode = byCode.get(key);
      if (sameCode && sameCode.bc_vendor_no && sameCode.bc_vendor_no.toUpperCase() !== key) {
        actions.push({
          type: 'FAILED',
          vendorNo: s.bc_vendor_no,
          reason: `Supplier code ${sameCode.supplier_code} is already linked to BC vendor ${sameCode.bc_vendor_no}.`,
          vendor,
        });
        continue;
      }
      if (sameCode) {
        row = sameCode;
        linkExisting = true;
      }
    }

    if (!row) {
      actions.push({ type: 'CREATE', vendorNo: s.bc_vendor_no, supplier: s });
      continue;
    }

    const changes: FieldChange[] = [];
    for (const field of BC_OWNED_SUPPLIER_FIELDS) {
      if (!same(row[field as keyof ExistingSupplier], s[field])) {
        changes.push({ field, from: row[field as keyof ExistingSupplier], to: s[field] });
      }
    }
    const restore = !!row.deleted_at;
    if (changes.length || linkExisting || restore || row.source_system !== 'BC') {
      actions.push({ type: 'UPDATE', vendorNo: s.bc_vendor_no, supplierId: row.supplier_id, supplier: s, changes, linkExisting, restore });
    } else {
      actions.push({ type: 'UNCHANGED', vendorNo: s.bc_vendor_no, supplierId: row.supplier_id, supplier: s, etagChanged: !same(row.bc_etag, s.bc_etag) });
    }
  }

  const bcSourced = existing.filter((r) => r.source_system === 'BC' && r.bc_vendor_no);
  const toDeactivate = bcSourced.filter((r) => !seen.has(r.bc_vendor_no!.toUpperCase()) && r.is_active && !r.deleted_at);
  for (const row of toDeactivate) {
    actions.push({
      type: 'DEACTIVATE',
      vendorNo: row.bc_vendor_no!,
      supplierId: row.supplier_id,
      reason: 'No longer synced from Business Central (NavFarm Sync unticked or vendor removed).',
    });
  }

  const counts = {
    create: actions.filter((a) => a.type === 'CREATE').length,
    update: actions.filter((a) => a.type === 'UPDATE').length,
    unchanged: actions.filter((a) => a.type === 'UNCHANGED').length,
    deactivate: toDeactivate.length,
    failed: actions.filter((a) => a.type === 'FAILED').length,
  };

  // A failed or partial read must not wipe the supplier list: refuse a run that would deactivate most of it.
  const activeBc = bcSourced.filter((r) => r.is_active && !r.deleted_at).length;
  const blockedReason =
    toDeactivate.length > 5 && activeBc > 0 && toDeactivate.length / activeBc > options.maxDeactivateRatio
      ? `Refused: the run would deactivate ${toDeactivate.length} of ${activeBc} active BC suppliers ` +
        `(limit ${Math.round(options.maxDeactivateRatio * 100)}%). Check the BC service, or raise BC_VENDOR_MAX_DEACTIVATE_RATIO deliberately.`
      : null;

  return { fetched: vendors.length, actions, counts, blockedReason };
}
