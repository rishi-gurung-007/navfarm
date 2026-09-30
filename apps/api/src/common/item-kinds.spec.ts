import { ITEM_KINDS, itemKindOf, kindMatchers } from './item-kinds';

/**
 * Found on the test server (Porta Farm, nf_portatestnavfarm): the Animal
 * Register's "Item (Living Asset)" picker is empty, because the code asks for
 * item_type = 'LIVESTOCK' while Porta's living-asset type is code "LA-001",
 * name "Living Asset". Same for feed: Porta's is "FEED-001". Tenants name
 * their own item types, so a KIND is decided from the type's code and name,
 * never from one hard-coded string.
 */
describe('itemKindOf — a tenant\'s own type codes still say what kind it is', () => {
  it.each([
    ['LIVESTOCK', 'Livestock'],
    ['LA-001', 'Living Asset'],
    ['LA-XYZ', 'Living asset — breeding'],
    ['LIVING_ASSET', 'Anything'],
    ['ANYTHING', 'Living Asset'],
    ['ANYTHING', 'LIVESTOCK — pigs'],
  ])('reads %s / %s as LIVESTOCK', (code, name) => {
    expect(itemKindOf(code, name)).toBe('LIVESTOCK');
  });

  it.each([
    ['FEED', 'Feed'],
    ['FEED-001', 'Feed'],
    ['FEED BULK', 'Anything'],
    ['FEED_BAG', 'Anything'],
    ['ANYTHING', 'Pig Feed'],
    ['ANYTHING', 'FEED — bulk'],
  ])('reads %s / %s as FEED', (code, name) => {
    expect(itemKindOf(code, name)).toBe('FEED');
  });

  it.each([
    ['MEDICINE', 'Medicine'],
    ['VACCINE', 'Vaccine'],
    ['RAW_MATERIAL', 'Raw Material'],
    ['FINISHED_GOODS', 'Finished Goods'],
    ['LABOUR', 'Labour'],
  ])('leaves %s / %s alone', (code, name) => {
    expect(itemKindOf(code, name)).not.toBe('FEED');
    expect(itemKindOf(code, name)).not.toBe('LIVESTOCK');
  });

  it('does not mistake a feeding-related name that is not a feed type', () => {
    // "FEEDER" starts with FEED, and the client's own types do too (FEED BULK),
    // so the prefix rule is deliberate; a name must contain the whole word.
    expect(itemKindOf('EQUIPMENT', 'Feeder trough')).toBeNull();
    expect(itemKindOf('EQUIPMENT', 'Livestock trailer')).toBe('LIVESTOCK');
  });

  it('is null when there is nothing to go on', () => {
    expect(itemKindOf(null, null)).toBeNull();
    expect(itemKindOf('', '')).toBeNull();
  });

  it('names the two kinds the API filters on', () => {
    expect(ITEM_KINDS).toEqual(['FEED', 'LIVESTOCK']);
  });
});

describe('kindMatchers — what a SQL filter needs', () => {
  it('gives the exact codes, the code prefixes and the name fragments per kind', () => {
    expect(kindMatchers('LIVESTOCK')).toEqual({
      codes: ['LIVESTOCK'],
      codePrefixes: ['LA-', 'LA_', 'LIVESTOCK', 'LIVING'],
      nameFragments: ['living asset', 'livestock'],
    });
    expect(kindMatchers('FEED')).toEqual({
      codes: ['FEED'],
      codePrefixes: ['FEED'],
      nameFragments: ['feed'],
    });
  });

  it('agrees with itemKindOf on every matcher it publishes', () => {
    for (const kind of ITEM_KINDS) {
      const m = kindMatchers(kind);
      for (const code of m.codes) expect(itemKindOf(code, 'x')).toBe(kind);
      for (const prefix of m.codePrefixes) expect(itemKindOf(`${prefix}001`, 'x')).toBe(kind);
      for (const fragment of m.nameFragments) expect(itemKindOf('ZZZ', `A ${fragment} type`)).toBe(kind);
    }
  });
});
