import { readBusinessCentralConfig } from '../business-central.config';
import { type BcVendorCard, mapBcVendor } from './bc-vendor.mapper';
import { type ExistingSupplier, planVendorSync } from './bc-vendor-sync.planner';
import { writeBackPatch } from './bc-vendor-sync.engine';

// Shapes copied from the live SandboxUAT VendorCardApi response (17 Nov 2026).
const vendor = (over: Partial<BcVendorCard> = {}): BcVendorCard => ({
  '@odata.etag': 'W/"JzIwOzE2MDQ5NTMwNzg0MjU0Njg3MTE2MTswMDsn"',
  No: 'VEN0001',
  Name: "IRVINE 'S AFRICA ",
  Name_2: 'IRV001 RAND',
  Blocked: ' ',
  Privacy_Blocked: false,
  Last_Date_Modified: '2026-11-03',
  Address: '72 Lytton Road',
  Address_2: 'Workington',
  City: 'HRE',
  County: 'ZW',
  Post_Code: '',
  Country_Region_Code: 'ZW',
  Phone_No: '',
  MobilePhoneNo: '0772000000',
  E_Mail: '',
  VAT_Registration_No: '10012345',
  Registration_Number: '',
  Payment_Terms_Code: '14 DAYS',
  Currency_Code: 'ZAR',
  Gen_Bus_Posting_Group: 'FOREIGN',
  Vendor_Posting_Group: 'TRADE FOREIGN OTHER',
  NavFarm_Sync: true,
  Sync_Status: ' ',
  Navfarm_Sync_Error: false,
  Navfarm_Error_Message: '',
  Status: 'Modified',
  ...over,
});

const existingFrom = (v: BcVendorCard, over: Partial<ExistingSupplier> = {}): ExistingSupplier => {
  const m = mapBcVendor(v);
  if (!m.ok) throw new Error('bad fixture');
  const s = m.supplier;
  return {
    supplier_id: `id-${s.bc_vendor_no}`,
    supplier_code: s.supplier_code,
    source_system: 'BC',
    bc_vendor_no: s.bc_vendor_no,
    bc_etag: s.bc_etag,
    deleted_at: null,
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
    ...over,
  };
};

describe('mapBcVendor', () => {
  it('maps the useful Vendor Card fields and trims BC padding', () => {
    const m = mapBcVendor(vendor());
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.supplier).toMatchObject({
      supplier_code: 'VEN0001',
      bc_vendor_no: 'VEN0001',
      supplier_name: "IRVINE 'S AFRICA",
      bc_name_2: 'IRV001 RAND',
      address_line1: '72 Lytton Road, Workington',
      city: 'HRE',
      state: 'ZW',
      country: 'ZW',
      pincode: null,
      phone: '0772000000', // falls back to the mobile when Phone No. is blank
      tax_number: '10012345',
      payment_terms: '14 DAYS',
      currency_code: 'ZAR',
      gen_bus_posting_group: 'FOREIGN',
      vendor_posting_group: 'TRADE FOREIGN OTHER',
      bc_blocked: null, // ' ' is BC's "not blocked"
      bc_last_modified_date: '2026-11-03',
      is_active: true,
    });
  });

  it('treats Blocked = All and Privacy Blocked as inactive, but Payment as still usable', () => {
    const all = mapBcVendor(vendor({ Blocked: 'All' }));
    const payment = mapBcVendor(vendor({ Blocked: 'Payment' }));
    const privacy = mapBcVendor(vendor({ Privacy_Blocked: true }));
    expect(all.ok && all.supplier.is_active).toBe(false);
    expect(payment.ok && payment.supplier.is_active).toBe(true);
    expect(payment.ok && payment.supplier.bc_blocked).toBe('Payment');
    expect(privacy.ok && privacy.supplier.is_active).toBe(false);
  });

  it('refuses a vendor without a name (two such vendors exist in SandboxUAT)', () => {
    expect(mapBcVendor(vendor({ Name: '  ' }))).toEqual({ ok: false, vendorNo: 'VEN0001', reason: 'Name is empty in Business Central.' });
  });

  it('treats a blank currency as BC local currency and 0001-01-01 as no date', () => {
    const m = mapBcVendor(vendor({ Currency_Code: '', Last_Date_Modified: '0001-01-01' }));
    expect(m.ok && m.supplier.currency_code).toBeNull();
    expect(m.ok && m.supplier.bc_last_modified_date).toBeNull();
  });
});

describe('planVendorSync', () => {
  it('creates a new supplier for a vendor NAVFarm has never seen', () => {
    const plan = planVendorSync([vendor()], []);
    expect(plan.counts).toEqual({ create: 1, update: 0, unchanged: 0, deactivate: 0, failed: 0 });
    expect(plan.actions[0]).toMatchObject({ type: 'CREATE', vendorNo: 'VEN0001' });
  });

  it('leaves an identical supplier alone and only notes a moved ETag', () => {
    const v = vendor();
    const plan = planVendorSync([{ ...v, '@odata.etag': 'W/"new"' }], [existingFrom(v)]);
    expect(plan.counts.unchanged).toBe(1);
    expect(plan.actions[0]).toMatchObject({ type: 'UNCHANGED', etagChanged: true });
  });

  it('updates only the fields BC changed, and reports them', () => {
    const v = vendor();
    const plan = planVendorSync([vendor({ Payment_Terms_Code: '30 DAYS', E_Mail: 'accounts@irvine.example' })], [existingFrom(v)]);
    const action = plan.actions[0];
    expect(action.type).toBe('UPDATE');
    if (action.type !== 'UPDATE') return;
    expect(action.changes.map((c) => c.field).sort()).toEqual(['email', 'payment_terms']);
  });

  it('links a NAVFarm supplier that already carries the vendor no. as its code', () => {
    const v = vendor();
    const local = existingFrom(v, { source_system: 'NAVFARM', bc_vendor_no: null, supplier_name: 'Irvine (typed locally)' });
    const action = planVendorSync([v], [local]).actions[0];
    expect(action).toMatchObject({ type: 'UPDATE', linkExisting: true, supplierId: local.supplier_id });
  });

  it('restores a soft-deleted BC supplier when the vendor is synced again', () => {
    const v = vendor();
    const action = planVendorSync([v], [existingFrom(v, { deleted_at: '2026-11-01 00:00:00' })]).actions[0];
    expect(action).toMatchObject({ type: 'UPDATE', restore: true });
  });

  it('deactivates — never deletes — a BC supplier whose vendor is no longer synced', () => {
    const plan = planVendorSync([], [existingFrom(vendor())]);
    expect(plan.actions).toEqual([expect.objectContaining({ type: 'DEACTIVATE', vendorNo: 'VEN0001' })]);
    expect(plan.blockedReason).toBeNull(); // one row is below the safety threshold
  });

  it('refuses a run that would deactivate most BC suppliers (a bad read must not wipe the list)', () => {
    const existing = Array.from({ length: 10 }, (_, i) => existingFrom(vendor({ No: `VEN10${i}` })));
    const plan = planVendorSync([], existing, { maxDeactivateRatio: 0.5 });
    expect(plan.counts.deactivate).toBe(10);
    expect(plan.blockedReason).toMatch(/Refused: the run would deactivate 10 of 10/);
  });

  it('never touches NAVFarm-created suppliers it did not match', () => {
    const local = existingFrom(vendor({ No: 'SUP-001' }), { source_system: 'NAVFARM', bc_vendor_no: null });
    expect(planVendorSync([], [local]).actions).toEqual([]);
  });

  it('refuses a vendor no. that collides with a supplier linked to another vendor', () => {
    const other = existingFrom(vendor({ No: 'VEN0099' }), { supplier_code: 'VEN0001' });
    const action = planVendorSync([vendor()], [other]).actions.find((a) => a.vendorNo === 'VEN0001');
    expect(action).toMatchObject({ type: 'FAILED' });
  });

  it('records a duplicate vendor no. as a failure', () => {
    expect(planVendorSync([vendor(), vendor()], []).counts).toMatchObject({ create: 1, failed: 1 });
  });
});

describe('writeBackPatch', () => {
  const cfg = readBusinessCentralConfig({}).vendor;

  it('writes the error flag and message for a failed vendor', () => {
    const v = vendor({ Name: '' });
    const plan = planVendorSync([v], []);
    expect(writeBackPatch(plan.actions[0], v, cfg)).toEqual({ Navfarm_Sync_Error: true, Navfarm_Error_Message: 'Name is empty in Business Central.' });
  });

  it('writes nothing when BC already shows a clean result and no Sync_Status value is configured', () => {
    const v = vendor();
    expect(writeBackPatch(planVendorSync([v], []).actions[0], v, cfg)).toBeNull();
  });

  it('clears an old error and sets the configured Sync_Status option', () => {
    const v = vendor({ Navfarm_Sync_Error: true, Navfarm_Error_Message: 'old' });
    const patch = writeBackPatch(planVendorSync([v], []).actions[0], v, { ...cfg, syncStatusSynced: 'Synced' });
    expect(patch).toEqual({ Navfarm_Sync_Error: false, Navfarm_Error_Message: '', Sync_Status: 'Synced' });
  });
});
