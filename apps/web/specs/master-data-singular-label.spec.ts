import { MASTER_DATA_CONFIGS } from '@/modules/master-data/configs';
import { singularLabel } from '@/modules/master-data/labels';

/**
 * "Add X" and "Edit X" singularise the master's plural label. Stripping a
 * trailing "s" is right for "Items" and wrong for everything else English
 * does, which is how the console came to offer "Add Number Serie".
 *
 * Every registered master is listed. A new master fails here until its
 * singular is stated — deliberately, since only the author of the label
 * knows whether it pluralises regularly.
 */
const EXPECTED: Record<string, string> = {
  activity: 'Activity',
  location: 'Location',
  'location-type': 'Location Type',
  stage: 'Stage',
  'number-series': 'Number Series',
  animal: 'Animal Register',
  item: 'Item',
  'item-type': 'Item Type',
  'item-category': 'Item Category',
  'item-attribute': 'Item Attribute',
  uom: 'Unit of Measure',
  'uom-conversion': 'UOM Conversion',
  species: 'Species',
  breed: 'Breed',
  'breed-lifecycle-stage': 'Breed Lifecycle Stage',
  disease: 'Disease',
  'feed-formula': 'Feed Formula',
  supplier: 'Supplier',
  customer: 'Customer',
  resource: 'Resource',
  'gl-account': 'GL Account',
  'gl-mapping': 'GL Mapping',
  'cost-center': 'Cost Center',
  reason: 'Reason',
  // "Currencies" -> "Currency": a -ies plural the trailing-s rule turns
  // into "Currencie", which is exactly what this map exists to catch.
  country: 'Country',
  currency: 'Currency',
  'exchange-rate': 'Exchange Rate',
};

describe('singularLabel', () => {
  it('covers every registered master, so a new one cannot slip through untested', () => {
    expect(MASTER_DATA_CONFIGS.map((c) => c.key).sort()).toEqual(
      Object.keys(EXPECTED).sort(),
    );
  });

  it.each(MASTER_DATA_CONFIGS.map((c) => [c.key, c] as const))(
    'singularises %s',
    (key, config) => {
      expect(singularLabel(config)).toBe(EXPECTED[key]);
    },
  );

  it("never leaves a mangled 'ie' ending, the shape the old s-stripping produced", () => {
    for (const config of MASTER_DATA_CONFIGS) {
      expect(singularLabel(config)).not.toMatch(/ie$/);
    }
  });
});
