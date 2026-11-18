/**
 * Business Central Vendor Card (ODataV4 web service "VendorCardApi") → NAVFarm supplier_master.
 *
 * The mapping is the contract written up in docs/bbp/BBP-BC-01-Vendor-Master-Integration.md §4. Only fields that
 * NAVFarm uses are read ($select), so balances and BC-internal setup never leave BC.
 */

/** The VendorCardApi fields NAVFarm reads. Names are the web service's, exactly. */
export const BC_VENDOR_SELECT = [
  'No',
  'Name',
  'Name_2',
  'Blocked',
  'Privacy_Blocked',
  'Last_Date_Modified',
  'Address',
  'Address_2',
  'City',
  'County',
  'Post_Code',
  'Country_Region_Code',
  'Phone_No',
  'MobilePhoneNo',
  'E_Mail',
  'VAT_Registration_No',
  'Registration_Number',
  'Payment_Terms_Code',
  'Currency_Code',
  'Gen_Bus_Posting_Group',
  'Vendor_Posting_Group',
  'Control16',
  'Purchaser_Code',
  'NavFarm_Sync',
  'Sync_Status',
  'Navfarm_Sync_Error',
  'Navfarm_Error_Message',
  'Status',
] as const;

export type BcVendorCard = {
  '@odata.etag'?: string;
  No: string;
  Name: string;
  Name_2?: string;
  Blocked?: string; // ' ', 'Payment', 'All'
  Privacy_Blocked?: boolean;
  Last_Date_Modified?: string; // YYYY-MM-DD (0001-01-01 when never set)
  Address?: string;
  Address_2?: string;
  City?: string;
  County?: string;
  Post_Code?: string;
  Country_Region_Code?: string;
  Phone_No?: string;
  MobilePhoneNo?: string;
  E_Mail?: string;
  VAT_Registration_No?: string;
  Registration_Number?: string;
  Payment_Terms_Code?: string;
  Currency_Code?: string;
  Gen_Bus_Posting_Group?: string;
  Vendor_Posting_Group?: string;
  Control16?: string; // BC label "Contact"
  Purchaser_Code?: string;
  NavFarm_Sync?: boolean;
  Sync_Status?: string;
  Navfarm_Sync_Error?: boolean;
  Navfarm_Error_Message?: string;
  Status?: string;
};

/** The supplier_master columns the sync owns. Everything else on the row is NAVFarm's and is never touched. */
export interface SupplierFromBc {
  supplier_code: string;
  bc_vendor_no: string;
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
  bc_last_modified_date: string | null;
  bc_etag: string | null;
  is_active: boolean;
}

/** The BC-owned columns, in the order they are compared and written. */
export const BC_OWNED_SUPPLIER_FIELDS = [
  'supplier_name',
  'bc_name_2',
  'address_line1',
  'city',
  'state',
  'country',
  'pincode',
  'phone',
  'email',
  'tax_number',
  'registration_number',
  'payment_terms',
  'currency_code',
  'gen_bus_posting_group',
  'vendor_posting_group',
  'contact_name',
  'purchaser_code',
  'bc_blocked',
  'is_active',
] as const satisfies ReadonlyArray<keyof SupplierFromBc>;

/** Fields a user may not change on a BC-sourced supplier (the sync would overwrite them). */
export const BC_LOCKED_DTO_FIELDS = [
  'supplier_code',
  'supplier_name',
  'email',
  'phone',
  'tax_number',
  'payment_terms',
  'address_line1',
  'city',
  'state',
  'country',
  'pincode',
  'is_active',
  'status',
] as const;

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const t = value.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

export type MapResult = { ok: true; supplier: SupplierFromBc } | { ok: false; vendorNo: string; reason: string };

export function mapBcVendor(v: BcVendorCard): MapResult {
  const vendorNo = text(v.No, 20);
  if (!vendorNo) return { ok: false, vendorNo: String(v.No ?? ''), reason: 'Vendor No. is empty.' };
  const name = text(v.Name, 150);
  if (!name) return { ok: false, vendorNo, reason: 'Name is empty in Business Central.' };

  const blocked = text(v.Blocked, 10); // ' ' → null
  const address = [text(v.Address, 100), text(v.Address_2, 50)].filter(Boolean).join(', ');
  const lastModified = text(v.Last_Date_Modified, 10);

  return {
    ok: true,
    supplier: {
      supplier_code: vendorNo,
      bc_vendor_no: vendorNo,
      supplier_name: name,
      bc_name_2: text(v.Name_2, 50),
      address_line1: address ? address.slice(0, 255) : null,
      city: text(v.City, 100),
      state: text(v.County, 100),
      country: text(v.Country_Region_Code, 100),
      pincode: text(v.Post_Code, 20),
      phone: text(v.Phone_No, 30) ?? text(v.MobilePhoneNo, 30),
      email: text(v.E_Mail, 200),
      tax_number: text(v.VAT_Registration_No, 50),
      registration_number: text(v.Registration_Number, 50),
      payment_terms: text(v.Payment_Terms_Code, 50),
      currency_code: text(v.Currency_Code, 10), // blank in BC = local currency
      gen_bus_posting_group: text(v.Gen_Bus_Posting_Group, 20),
      vendor_posting_group: text(v.Vendor_Posting_Group, 20),
      contact_name: text(v.Control16, 100),
      purchaser_code: text(v.Purchaser_Code, 20),
      bc_blocked: blocked,
      bc_last_modified_date: lastModified && !lastModified.startsWith('0001') ? lastModified : null,
      bc_etag: text(v['@odata.etag'], 100),
      // "Blocked = All" or privacy-blocked: the vendor may not be used at all. "Payment" only stops payments,
      // so goods can still be received — the supplier stays active and bc_blocked shows why.
      is_active: blocked !== 'All' && !v.Privacy_Blocked,
    },
  };
}
