import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

/**
 * Supplier form bounds (Freebuff task-3, item 3): Supplier Name max 50;
 * descriptive text fields max 50; Country/State/City letters and spaces only;
 * Postal Code digits only. Mirrored by maxLength/pattern in the supplier
 * master config so the form refuses what the API would reject.
 */
const base = {
  supplier_name: 'Feed Ingredients Corp Ltd',
};

const ofCreate = async (extra: Record<string, unknown>) =>
  validate(plainToInstance(CreateSupplierDto, { ...base, ...extra }));

describe('Supplier DTO — text bounds', () => {
  it('accepts a 50-character supplier name and refuses 51', async () => {
    const ok = await ofCreate({ supplier_name: 'A'.repeat(50) });
    expect(ok.find((e) => e.property === 'supplier_name')).toBeUndefined();

    const over = await ofCreate({ supplier_name: 'A'.repeat(51) });
    expect(over.find((e) => e.property === 'supplier_name')).toBeDefined();
  });

  it('caps descriptive fields (phone, tax number, payment terms, address line 1, bank fields) at 50', async () => {
    const over = await ofCreate({
      phone: '1'.repeat(51),
      tax_number: '1'.repeat(51),
      payment_terms: '1'.repeat(51),
      address_line1: '1'.repeat(51),
      bank_account_no: '1'.repeat(51),
      bank_ifsc: '1'.repeat(51),
      health_cert_url: '1'.repeat(51),
      breeding_farm_code: '1'.repeat(51),
    });
    for (const key of ['phone', 'tax_number', 'payment_terms', 'address_line1', 'bank_account_no', 'bank_ifsc', 'health_cert_url', 'breeding_farm_code']) {
      expect(over.find((e) => e.property === key)).toBeDefined();
    }
  });

  it('accepts letters and spaces in City, State and Country, including multi-word names', async () => {
    const ok = await ofCreate({ city: 'Norton', state: 'Mashonaland West', country: 'Zimbabwe' });
    for (const key of ['city', 'state', 'country']) {
      expect(ok.find((e) => e.property === key)).toBeUndefined();
    }
  });

  it('refuses digits or punctuation in City, State and Country', async () => {
    const bad = await ofCreate({ city: 'Harare1', state: 'Mash-West', country: 'Zimbabwe 2' });
    for (const key of ['city', 'state', 'country']) {
      expect(bad.find((e) => e.property === key)).toBeDefined();
    }
  });

  it('accepts digits in Postal Code and refuses letters', async () => {
    const ok = await ofCreate({ pincode: '0123456789' });
    expect(ok.find((e) => e.property === 'pincode')).toBeUndefined();

    const bad = await ofCreate({ pincode: '12A45' });
    expect(bad.find((e) => e.property === 'pincode')).toBeDefined();
  });

  it('leaves every bound optional — absent values pass', async () => {
    const empty = await ofCreate({});
    expect(empty).toEqual([]);
  });

  it('keeps the same bounds on update', async () => {
    const bad = validate(plainToInstance(UpdateSupplierDto, {
      supplier_name: 'B'.repeat(51),
      country: 'Z1mbabwe',
      pincode: 'AB12',
      city: 'Norton9',
      state: 'St@te',
    }));
    const errors = await bad;
    for (const key of ['supplier_name', 'country', 'pincode', 'city', 'state']) {
      expect(errors.find((e) => e.property === key)).toBeDefined();
    }

    const ok = await validate(plainToInstance(UpdateSupplierDto, { country: 'Zimbabwe', pincode: '12345' }));
    expect(ok.find((e) => e.property === 'country')).toBeUndefined();
    expect(ok.find((e) => e.property === 'pincode')).toBeUndefined();
  });
});
