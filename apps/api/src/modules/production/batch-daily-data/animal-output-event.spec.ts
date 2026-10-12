import { parsePoolIds } from './animal-output-event';

describe('parsePoolIds', () => {
  it('reads the JSON array a draft keeps, and a value already parsed', () => {
    expect(parsePoolIds('["boar-2","boar-3"]')).toEqual(['boar-2', 'boar-3']);
    expect(parsePoolIds(['boar-2'])).toEqual(['boar-2']);
  });

  it('reads nothing as no pool, and never throws on a bad value', () => {
    expect(parsePoolIds(null)).toEqual([]);
    expect(parsePoolIds(undefined)).toEqual([]);
    expect(parsePoolIds('')).toEqual([]);
    expect(parsePoolIds('not json')).toEqual([]);
    expect(parsePoolIds('{"a":1}')).toEqual([]);
  });

  it('keeps only ids', () => {
    expect(parsePoolIds('["boar-2", 7, null, ""]')).toEqual(['boar-2']);
  });
});
