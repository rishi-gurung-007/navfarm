import {
  coordinate, DEFAULT_OSRM_BASE_URL, isPoint, osrmDistanceKm, osrmUrl, roundKm, straightLineKm,
} from './road-distance';

describe('Route stop distance', () => {
  // Harare (the mill) to Chinhoyi, about 102 km apart in a straight line and some 117 km by road.
  const harare = { latitude: -17.8252, longitude: 31.0335 };
  const chinhoyi = { latitude: -17.3667, longitude: 30.2 };

  it('measures the straight line between two points', () => {
    expect(roundKm(straightLineKm(harare, chinhoyi))).toBe(102);
    expect(straightLineKm(harare, harare)).toBe(0);
  });

  it('rounds to the one decimal the column stores', () => {
    expect(roundKm(18.4499)).toBe(18.4);
    expect(roundKm(18.45)).toBe(18.5);
  });

  it('asks OSRM for a driving route, longitude first', () => {
    expect(osrmUrl(DEFAULT_OSRM_BASE_URL, harare, chinhoyi)).toBe(
      'https://router.project-osrm.org/route/v1/driving/31.0335,-17.8252;30.2,-17.3667?overview=false&alternatives=false',
    );
    expect(osrmUrl('https://osrm.internal/', harare, chinhoyi)).toContain('https://osrm.internal/route/v1/driving/');
  });

  it('reads the driving distance in km, and nothing from a response that did not route', () => {
    expect(osrmDistanceKm({ code: 'Ok', routes: [{ distance: 120500 }] })).toBe(120.5);
    expect(osrmDistanceKm({ code: 'NoRoute', routes: [] })).toBeNull();
    expect(osrmDistanceKm({ code: 'Ok', routes: [] })).toBeNull();
    expect(osrmDistanceKm({ code: 'Ok', routes: [{ distance: -1 }] })).toBeNull();
    expect(osrmDistanceKm(null)).toBeNull();
    expect(osrmDistanceKm('<html>502 Bad Gateway</html>')).toBeNull();
  });

  // A zone with a latitude and no longitude was read as sitting on the Greenwich meridian — Number(null) is 0,
  // and 0 is a valid longitude — and the stop before it came out 3,228 km away.
  it('reads an empty coordinate column as nothing, not as zero', () => {
    expect(coordinate(null)).toBeNull();
    expect(coordinate(undefined)).toBeNull();
    expect(coordinate('')).toBeNull();
    expect(coordinate('not a number')).toBeNull();
    expect(coordinate(0)).toBe(0);
    expect(coordinate('-17.8252000')).toBe(-17.8252);
  });

  it('takes only a real pair of coordinates', () => {
    expect(isPoint(harare)).toBe(true);
    expect(isPoint({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isPoint({ latitude: 0, longitude: 181 })).toBe(false);
    expect(isPoint({ latitude: NaN, longitude: 0 })).toBe(false);
    expect(isPoint({ latitude: null, longitude: 0 })).toBe(false);
    expect(isPoint(null)).toBe(false);
  });
});
