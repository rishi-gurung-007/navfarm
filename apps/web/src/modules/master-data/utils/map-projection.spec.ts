import { latToTileY, lngToTileX, tileXToLng, tileYToLat, wrapTileX } from './map-projection';

describe('Web Mercator projection', () => {
  it('puts the origin at the top-left of the world and the middle in the middle', () => {
    expect(lngToTileX(-180, 0)).toBe(0);
    expect(lngToTileX(0, 1)).toBe(1);
    expect(latToTileY(0, 1)).toBeCloseTo(1, 10);
  });

  it('round-trips a point back to itself', () => {
    for (const [lat, lng] of [
      [-17.8252, 31.0335], // Harare
      [-17.3667, 30.2], // Chinhoyi
      [51.5072, -0.1276],
      [0, 0],
    ]) {
      for (const zoom of [2, 6, 13, 18]) {
        expect(tileYToLat(latToTileY(lat, zoom), zoom)).toBeCloseTo(lat, 9);
        expect(tileXToLng(lngToTileX(lng, zoom), zoom)).toBeCloseTo(lng, 9);
      }
    }
  });

  it('clamps beyond the latitude Mercator can draw rather than running to infinity', () => {
    expect(Number.isFinite(latToTileY(90, 5))).toBe(true);
    expect(latToTileY(90, 5)).toBe(latToTileY(85.05112878, 5));
    expect(latToTileY(-90, 5)).toBe(latToTileY(-85.05112878, 5));
  });

  it('wraps a tile column round the world, in both directions', () => {
    expect(wrapTileX(-1, 2)).toBe(3);
    expect(wrapTileX(4, 2)).toBe(0);
    expect(wrapTileX(2, 2)).toBe(2);
  });
});
