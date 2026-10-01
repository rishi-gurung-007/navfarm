import { getConfig } from '../src/modules/master-data/configs';

type IdentityFields = {
  code: string;
  name?: string;
};

// A master form is already scoped by its title (for example, "Add Breed").
// Repeating that noun in "Breed Code" and "Breed Name" adds noise without
// adding meaning. Reference fields keep their specific labels because those
// labels identify a different entity.
const IDENTITIES: Record<string, IdentityFields> = {
  'location-type': { code: 'type_code', name: 'type_name' },
  location: { code: 'location_code', name: 'location_name' },
  stage: { code: 'stage_code', name: 'stage_name' },
  'number-series': { code: 'code' },
  activity: { code: 'activity_code', name: 'activity_name' },
  animal: { code: 'animal_code' },
  'item-category': { code: 'category_code', name: 'category_name' },
  'item-type': { code: 'type_code', name: 'type_name' },
  uom: { code: 'uom_code', name: 'uom_name' },
  'uom-conversion': { code: 'conversion_code' },
  'item-attribute': { code: 'attribute_code', name: 'attribute_name' },
  'item-template': { code: 'template_code' },
  item: { code: 'item_code', name: 'item_name' },
  species: { code: 'species_code', name: 'species_name' },
  breed: { code: 'breed_code', name: 'breed_name' },
  'breed-lifecycle-stage': { code: 'lifecycle_code' },
  'kpi-metric': { code: 'metric_code', name: 'metric_name' },
  reason: { code: 'reason_code' },
  'alert-rule': { code: 'notification_code', name: 'notification_name' },
  'reporting-period': { code: 'period_code' },
  disease: { code: 'disease_code', name: 'disease_name' },
  'feed-formula': { code: 'formula_code', name: 'formula_name' },
  supplier: { code: 'supplier_code', name: 'supplier_name' },
  customer: { code: 'customer_code', name: 'customer_name' },
  resource: { code: 'resource_code', name: 'resource_name' },
  'gl-account': { code: 'account_code', name: 'account_name' },
  'gl-mapping': { code: 'mapping_code' },
  'cost-center': { code: 'cost_center_code', name: 'cost_center_name' },
  country: { code: 'iso2', name: 'country_name' },
  currency: { code: 'iso_code', name: 'currency_name' },
};

describe('master identity labels', () => {
  it.each(Object.entries(IDENTITIES))('%s uses plain Code and Name labels', (configKey, identity) => {
    const config = getConfig(configKey)!;
    const field = (key: string) => config.fields.find((candidate) => candidate.key === key);
    const column = (key: string) => config.columns?.find((candidate) => candidate.key === key);

    expect(field(identity.code)?.label).toBe('Code');
    if (column(identity.code)) expect(column(identity.code)?.label).toBe('Code');

    if (identity.name) {
      expect(field(identity.name)?.label).toBe('Name');
      if (column(identity.name)) expect(column(identity.name)?.label).toBe('Name');
    }
  });

  it('keeps referenced entities specific', () => {
    expect(getConfig('animal')!.fields.find((field) => field.key === 'breed_id')?.label).toBe('Breed');
    expect(getConfig('breed-lifecycle-stage')!.fields.find((field) => field.key === 'stage_id')?.label).toBe('Stage');
    expect(getConfig('gl-mapping')!.fields.find((field) => field.key === 'item_category_id')?.label).toBe('Item Category');
  });
});
