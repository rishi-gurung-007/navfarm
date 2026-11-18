/**
 * Web Mercator, the projection OpenStreetMap tiles are cut to: the maths behind MapPointPicker, kept apart from
 * the component so a click landing on the right coordinates can be tested without a browser.
 *
 * A "tile coordinate" is the position in tiles at a given zoom; multiply by the 256-pixel tile size for the world
 * pixel the picker lays tiles and markers out in.
 */

export const TILE_SIZE = 256;
/** Mercator cannot draw the poles, so the projection is cut where the square map ends. */
export const MAX_LATITUDE = 85.05112878;

export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export const lngToTileX = (lng: number, zoom: number) => ((lng + 180) / 360) * 2 ** zoom;

export const latToTileY = (lat: number, zoom: number) => {
  const radians = (clamp(lat, -MAX_LATITUDE, MAX_LATITUDE) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** zoom;
};

export const tileXToLng = (x: number, zoom: number) => (x / 2 ** zoom) * 360 - 180;

export const tileYToLat = (y: number, zoom: number) => {
  const n = Math.PI - 2 * Math.PI * (y / 2 ** zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

/** A tile column off either edge of the world is the column from the other side: longitude wraps, latitude does not. */
export const wrapTileX = (x: number, zoom: number) => {
  const span = 2 ** zoom;
  return ((x % span) + span) % span;
};
