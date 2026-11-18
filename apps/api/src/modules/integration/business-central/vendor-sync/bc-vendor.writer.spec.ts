import { BcVendorInputError, changedBcFields, looksLikeVendorNo, splitAddress, toBcVendorFields } from './bc-vendor.writer';

describe('toBcVendorFields (NAVFarm supplier → BC Vendor Card)', () => {
  it('maps to the VendorCardApi field names and upper-cases BC code fields', () => {
    expect(
      toBcVendorFields({
        supplier_name: 'Irvine Africa',
        city: 'Harare',
        state: 'HRE',
        pincode: 'hre',
        country: 'zw',
        phone: '+263 77 000 0000',
        email: 'accounts@irvine.example',
        tax_number: '10012345',
        payment_terms: '14 days',
        currency_code: 'zar',
        gen_bus_posting_group: 'foreign',
        vendor_posting_group: 'trade foreign other',
      }),
    ).toEqual({
      Name: 'Irvine Africa',
      City: 'Harare',
      County: 'HRE',
      Post_Code: 'HRE',
      Country_Region_Code: 'ZW',
      Phone_No: '+263 77 000 0000',
      E_Mail: 'accounts@irvine.example',
      VAT_Registration_No: '10012345',
      Payment_Terms_Code: '14 DAYS',
      Currency_Code: 'ZAR',
      Gen_Bus_Posting_Group: 'FOREIGN',
      Vendor_Posting_Group: 'TRADE FOREIGN OTHER',
    });
  });

  it('sends only the fields given, and blank clears a BC field', () => {
    expect(toBcVendorFields({ payment_terms: '30 days' })).toEqual({ Payment_Terms_Code: '30 DAYS' });
    expect(toBcVendorFields({ currency_code: '' })).toEqual({ Currency_Code: '' });
  });

  it('names every field that is longer than BC allows', () => {
    expect(() => toBcVendorFields({ city: 'C'.repeat(31), country: 'Zimbabwe Republic' })).toThrow(
      new BcVendorInputError('Longer than Business Central allows: city (max 30), country (max 10).'),
    );
  });
});

describe('splitAddress', () => {
  it('splits the "street, suburb" the sync joined back into Address and Address 2', () => {
    expect(splitAddress('72 Lytton Road, Workington')).toEqual({ Address: '72 Lytton Road', Address_2: 'Workington' });
  });
  it('keeps a short address on one line', () => {
    expect(splitAddress('188 INDUSTRIAL SITE')).toEqual({ Address: '188 INDUSTRIAL SITE', Address_2: '' });
  });
  it('refuses an address that cannot fit 100 + 50', () => {
    expect(() => splitAddress('x'.repeat(200))).toThrow(BcVendorInputError);
  });
});

describe('changedBcFields', () => {
  const current = { supplier_name: 'IRVINE', payment_terms: '14 DAYS', email: null, vendor_type: 'GENERAL' };
  it('ignores re-sent unchanged values (case-insensitive for codes) and NAVFarm-only fields', () => {
    expect(changedBcFields(current, { supplier_name: 'IRVINE ', payment_terms: '14 days', email: '', vendor_type: 'FEED_SUPPLIER' })).toEqual({});
  });
  it('returns only what changed', () => {
    expect(changedBcFields(current, { supplier_name: 'IRVINE', payment_terms: '30 DAYS' })).toEqual({ payment_terms: '30 DAYS' });
  });
});

describe('looksLikeVendorNo', () => {
  it('tells a vendor no. prefix from a name', () => {
    expect(looksLikeVendorNo('VEN01')).toBe(true);
    expect(looksLikeVendorNo('VEN0001')).toBe(true);
    expect(looksLikeVendorNo('BUHLER')).toBe(false); // no digit → name search
    expect(looksLikeVendorNo('TOP PIGS')).toBe(false);
  });
});
