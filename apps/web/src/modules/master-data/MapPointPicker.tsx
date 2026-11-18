'use client';

/**
 * Pick a point by clicking a map, for the lat/long on a Delivery Zone and a Route Stop (Rishi, 5 Nov).
 *
 * OpenStreetMap tiles, drawn directly: no map library. Leaflet would need a dynamic import to survive Next's
 * server render, its stylesheet copied into the build, and a runtime dependency — for a picker that pans, zooms
 * and drops one pin, the Web Mercator maths below is the smaller thing to own. Tiles are plain <img> elements,
 * so a browser with no route to openstreetmap.org simply shows the grid empty and the coordinates still work:
 * they can be typed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Loader2, LocateFixed, Minus, Plus } from 'lucide-react';
import {
  clamp, latToTileY, lngToTileX, TILE_SIZE as TILE, tileXToLng, tileYToLat, wrapTileX,
} from './utils/map-projection';

const MIN_ZOOM = 2;
const MAX_ZOOM = 18;
/** Where the map opens with nothing recorded yet: Harare, wide enough to show the country. */
const DEFAULT_CENTRE = { latitude: -17.8252, longitude: 31.0335 };
const DEFAULT_ZOOM = 6;
/** Close enough to read a farm gate off the map once a point is known. */
const PICKED_ZOOM = 13;

/** A point drawn for context rather than picked: where a route starts and ends, and the stops already on it. */
export interface MapMark {
  latitude: number;
  longitude: number;
  label: string;
  kind?: 'START' | 'END' | 'STOP';
}

export interface MapPointPickerProps {
  latitude: number | null;
  longitude: number | null;
  onPick: (latitude: number, longitude: number) => void;
  disabled?: boolean;
  /** Drawn alongside the picked point, so a new one can be placed against what is already there. */
  marks?: MapMark[];
  height?: number;
  busy?: boolean;
}

/** How each kind of context mark is drawn, and what it is called in the key below the map. */
const MARK_STYLE: Record<NonNullable<MapMark['kind']>, { colour: string; legend: string }> = {
  START: { colour: 'var(--success, #15803d)', legend: 'Start' },
  END: { colour: 'var(--accent)', legend: 'Destination' },
  STOP: { colour: 'var(--text-secondary)', legend: 'Existing stop' },
};

export function MapPointPicker({
  latitude,
  longitude,
  onPick,
  disabled,
  marks,
  height = 300,
  busy,
}: MapPointPickerProps) {
  const hasPoint = latitude !== null && longitude !== null;
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height });
  const [zoom, setZoom] = useState(hasPoint ? PICKED_ZOOM : DEFAULT_ZOOM);
  const [centre, setCentre] = useState(
    hasPoint ? { latitude: latitude as number, longitude: longitude as number } : DEFAULT_CENTRE,
  );
  // A press that moved is a pan, not a pick — otherwise every drag would drop the pin where it let go.
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  // Set when the point changed because this map was clicked, so the "follow the value" effect below leaves the
  // view alone. Without it, placing a point after zooming out snapped straight back to the close-in zoom.
  const pickedHereRef = useRef(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => setSize({ width: frame.clientWidth, height: frame.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  // Follow the value when it changes from outside the map (typed in, or loaded into the form for editing).
  const pointKey = hasPoint ? `${latitude},${longitude}` : '';
  useEffect(() => {
    if (!pointKey) return;
    // A point set by clicking this map is already where the viewer put it; only an outside change moves the view.
    if (pickedHereRef.current) {
      pickedHereRef.current = false;
      return;
    }
    const [lat, lng] = pointKey.split(',').map(Number);
    setCentre({ latitude: lat, longitude: lng });
    setZoom((current) => (current < PICKED_ZOOM ? PICKED_ZOOM : current));
  }, [pointKey]);

  /**
   * With nothing picked yet, open where the route is rather than on the default centre — a map of Zimbabwe is no
   * help for placing a stop between two farms you cannot see. Runs once per set of marks, and never fights a
   * point that is already chosen.
   */
  const marksKey = (marks ?? []).map((m) => `${m.latitude},${m.longitude}`).join('|');
  useEffect(() => {
    if (pointKey || !marksKey || !size.width || !size.height) return;
    const points = marksKey.split('|').map((pair) => {
      const [lat, lng] = pair.split(',').map(Number);
      return { latitude: lat, longitude: lng };
    });
    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);
    setCentre({
      latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
      longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    });
    // The zoom whose span still holds every mark, with a margin so none sits on the frame's edge.
    let fitted = PICKED_ZOOM;
    for (let z = MAX_ZOOM; z >= MIN_ZOOM; z -= 1) {
      const widthPx = (Math.max(...lngs.map((l) => lngToTileX(l, z))) - Math.min(...lngs.map((l) => lngToTileX(l, z)))) * TILE;
      const heightPx = (Math.max(...lats.map((l) => latToTileY(l, z))) - Math.min(...lats.map((l) => latToTileY(l, z)))) * TILE;
      if (widthPx <= size.width * 0.7 && heightPx <= size.height * 0.7) { fitted = z; break; }
    }
    setZoom(fitted);
  }, [marksKey, pointKey, size.width, size.height]);

  /** The world pixel at the frame's top-left corner — everything else is drawn relative to it. */
  const topLeft = useMemo(
    () => ({
      x: lngToTileX(centre.longitude, zoom) * TILE - size.width / 2,
      y: latToTileY(centre.latitude, zoom) * TILE - size.height / 2,
    }),
    [centre, zoom, size],
  );

  const screenOf = useCallback(
    (point: { latitude: number; longitude: number }) => ({
      left: lngToTileX(point.longitude, zoom) * TILE - topLeft.x,
      top: latToTileY(point.latitude, zoom) * TILE - topLeft.y,
    }),
    [zoom, topLeft],
  );

  const pointAt = useCallback(
    (offsetX: number, offsetY: number) => ({
      latitude: tileYToLat((topLeft.y + offsetY) / TILE, zoom),
      longitude: tileXToLng((topLeft.x + offsetX) / TILE, zoom),
    }),
    [topLeft, zoom],
  );

  const tiles = useMemo(() => {
    if (!size.width || !size.height) return [];
    const span = 2 ** zoom;
    const out: Array<{ key: string; src: string; left: number; top: number }> = [];
    for (let x = Math.floor(topLeft.x / TILE); x <= Math.floor((topLeft.x + size.width) / TILE); x += 1) {
      for (let y = Math.floor(topLeft.y / TILE); y <= Math.floor((topLeft.y + size.height) / TILE); y += 1) {
        if (y < 0 || y >= span) continue;
        const wrapped = wrapTileX(x, zoom);
        out.push({
          key: `${zoom}/${x}/${y}`,
          src: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${y}.png`,
          left: x * TILE - topLeft.x,
          top: y * TILE - topLeft.y,
        });
      }
    }
    return out;
  }, [topLeft, zoom, size]);

  /**
   * Zoom about a fixed screen point, so whatever is under the cursor stays under it. The point at (x, y) must end
   * up at (x, y) again, so the new centre is that point's world pixel, less the corner-to-cursor offset.
   */
  const zoomBy = useCallback(
    (step: number, anchorX?: number, anchorY?: number) => {
      const next = clamp(zoom + step, MIN_ZOOM, MAX_ZOOM);
      if (next === zoom) return;
      const x = anchorX ?? size.width / 2;
      const y = anchorY ?? size.height / 2;
      const anchor = pointAt(x, y);
      const centreX = lngToTileX(anchor.longitude, next) * TILE - x + size.width / 2;
      const centreY = latToTileY(anchor.latitude, next) * TILE - y + size.height / 2;
      setCentre({ latitude: tileYToLat(centreY / TILE, next), longitude: tileXToLng(centreX / TILE, next) });
      setZoom(next);
    },
    [zoom, size, pointAt],
  );

  // React's onWheel listener is passive, so it cannot stop the page scrolling; this one is not.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || disabled) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = frame.getBoundingClientRect();
      zoomBy(event.deltaY < 0 ? 1 : -1, event.clientX - rect.left, event.clientY - rect.top);
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, [zoomBy, disabled]);

  /** True for a press that began on a control drawn over the map (the zoom buttons), not on the map itself. */
  const onControl = (event: React.PointerEvent<HTMLDivElement>) =>
    !!(event.target as HTMLElement | null)?.closest?.('[data-map-control]');

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || onControl(event)) return;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    setCentre((current) => ({
      latitude: tileYToLat((latToTileY(current.latitude, zoom) * TILE - dy) / TILE, zoom),
      longitude: tileXToLng((lngToTileX(current.longitude, zoom) * TILE - dx) / TILE, zoom),
    }));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.pointerId !== event.pointerId || disabled || onControl(event)) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (drag.moved) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const picked = pointAt(event.clientX - rect.left, event.clientY - rect.top);
    pickedHereRef.current = true;
    onPick(Number(picked.latitude.toFixed(7)), Number(picked.longitude.toFixed(7)));
  };

  const marker = hasPoint ? screenOf({ latitude: latitude as number, longitude: longitude as number }) : null;
  const drawn = marks ?? [];
  const legend = [...new Set(drawn.map((m) => m.kind ?? 'STOP'))];
  const zoomButton =
    'flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border text-sm disabled:opacity-40';

  return (
    <div className="space-y-1.5">
      <div
        ref={frameRef}
        data-map-picker=""
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        className="relative overflow-hidden rounded-[var(--radius-sm)] border"
        style={{
          height,
          borderColor: 'var(--border)',
          backgroundColor: 'var(--surface-raised)',
          cursor: disabled ? 'default' : 'crosshair',
          touchAction: 'none',
        }}
      >
        {tiles.map((tile) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={tile.key}
            src={tile.src}
            alt=""
            width={TILE}
            height={TILE}
            draggable={false}
            className="pointer-events-none absolute select-none"
            style={{ left: tile.left, top: tile.top }}
          />
        ))}

        {drawn.map((mark, index) => {
          const at = screenOf(mark);
          const style = MARK_STYLE[mark.kind ?? 'STOP'];
          return (
            <div
              key={`${mark.kind}-${index}-${mark.latitude},${mark.longitude}`}
              className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1"
              style={{ left: at.left, top: at.top }}
              title={mark.label}
            >
              <span
                className="h-3 w-3 shrink-0 rounded-full border-2"
                style={{ borderColor: style.colour, backgroundColor: 'var(--surface)' }}
              />
              <span
                className="max-w-[140px] truncate rounded px-1 text-[10px] leading-4"
                style={{ backgroundColor: 'var(--surface)', color: style.colour }}
              >
                {mark.label}
              </span>
            </div>
          );
        })}

        {marker && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full"
            style={{ left: marker.left, top: marker.top }}
          >
            <Crosshair className="h-5 w-5" style={{ color: 'var(--danger)' }} strokeWidth={2.5} />
          </div>
        )}

        {!disabled && (
          <div data-map-control="" className="absolute right-2 top-2 flex flex-col gap-1">
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() => zoomBy(1)}
              disabled={zoom >= MAX_ZOOM}
              className={zoomButton}
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => zoomBy(-1)}
              disabled={zoom <= MIN_ZOOM}
              className={zoomButton}
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            {/* Bring the point back into view after panning away from it, at whatever zoom is currently set. */}
            <button
              type="button"
              aria-label="Centre on the point"
              title="Centre on the point"
              onClick={() => hasPoint && setCentre({ latitude: latitude as number, longitude: longitude as number })}
              disabled={!hasPoint}
              className={zoomButton}
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              <LocateFixed className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {busy && (
          <div
            className="absolute left-2 top-2 flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1 text-[11px]"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            Working out the distance…
          </div>
        )}

        <div
          className="pointer-events-none absolute bottom-0 right-0 px-1 text-[10px]"
          style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)' }}
        >
          © OpenStreetMap contributors
        </div>
      </div>

      {legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {legend.map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1">
              <span
                className="h-2.5 w-2.5 rounded-full border-2"
                style={{ borderColor: MARK_STYLE[kind].colour, backgroundColor: 'var(--surface)' }}
              />
              {MARK_STYLE[kind].legend}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <Crosshair className="h-2.5 w-2.5" style={{ color: 'var(--danger)' }} />
            This stop
          </span>
        </div>
      )}
    </div>
  );
}

export default MapPointPicker;
