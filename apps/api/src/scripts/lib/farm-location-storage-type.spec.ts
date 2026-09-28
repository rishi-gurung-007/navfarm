import { FARM_LOCATION_SEED, storageFieldsFor } from './farm-location-seed-data';

/**
 * F4 (28 Sep, found by driving the rebuilt demo). D28 and migration 0126
 * clear `storage_type = 'SILO'` from pens, sheds and crates, because the
 * older silo-fields check keyed on it and refused every save of them. The
 * client's location master carries that value on all 248 of those rows, so
 * `db-rebuild-demo` put them straight back and the release's own post-check
 * read 248 instead of 0 on any freshly seeded database.
 *
 * The seeder normalises instead of the data being hand-edited, so a later
 * template import cannot reintroduce it.
 */
describe('F4 — a seeded pen, shed or crate carries no silo storage type', () => {
  it('keeps storage_type only where the location really is a silo or a store', () => {
    const offenders = FARM_LOCATION_SEED
      .map((row) => ({ code: row.code, type: row.type, ...storageFieldsFor(row) }))
      .filter((r) => r.storage_type !== null && !['SILO', 'STORE'].includes(r.type));
    expect(offenders).toEqual([]);
  });

  it('drops the silo name with the type, and keeps both on a real silo or store', () => {
    expect(storageFieldsFor({ type: 'PEN', storageType: 'SILO', storageName: 'MGH8' }))
      .toEqual({ storage_type: null, storage_name: null });
    expect(storageFieldsFor({ type: 'SILO', storageType: 'SILO', storageName: 'MGH8' }))
      .toEqual({ storage_type: 'SILO', storage_name: 'MGH8' });
    expect(storageFieldsFor({ type: 'STORE', storageType: 'STORE', storageName: 'STORE' }))
      .toEqual({ storage_type: 'STORE', storage_name: 'STORE' });
  });

  it('leaves the silo capacity a shed carries alone — that figure is the client\'s, and Plan A\'s silo links read it', () => {
    const shed = FARM_LOCATION_SEED.find((r) => r.type === 'SHED' && r.siloCapacityKg != null);
    expect(shed?.siloCapacityKg).toBeGreaterThan(0);
  });
});
