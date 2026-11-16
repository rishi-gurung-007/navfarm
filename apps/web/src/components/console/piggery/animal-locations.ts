'use client';

import { useEffect, useState } from 'react';
import { api } from '@/services/api-client';

type Row = Record<string, any>;

/** Where an animal can stand. The API refuses the others (animal-placement.rules.ts); the pickers do not offer them. */
export const ANIMAL_LOCATION_TYPES = ['SHED', 'PEN', 'CRATE'];

/** The farm a location belongs to: itself for a farm, else its farm_id, else the farm at the top of its parents. */
export function farmIdOf(location: Row, byId: Map<string, Row>): string | null {
  if (!location.parent_location_id) return location.location_id ?? null;
  if (location.farm_id) return location.farm_id;
  let parent = byId.get(location.parent_location_id);
  for (let depth = 0; parent && depth < 8; depth += 1) {
    if (!parent.parent_location_id) return parent.location_id;
    parent = byId.get(parent.parent_location_id);
  }
  return null;
}

/**
 * The locations an animal may be moved to on one farm, as picker options. `farmId` null offers every farm's (the API
 * still refuses one that does not fit); `exclude` drops the location the animal is already in.
 */
export function animalLocationOptions(locations: Row[], farmId: string | null, exclude?: string | null) {
  const byId = new Map(locations.map((l) => [l.location_id, l]));
  return locations
    .filter((l) => l.is_active !== false && ANIMAL_LOCATION_TYPES.includes(String(l.location_type)))
    .filter((l) => !farmId || farmIdOf(l, byId) === farmId)
    .filter((l) => l.location_id !== exclude)
    .sort((a, b) => String(a.location_code).localeCompare(String(b.location_code)))
    .map((l) => ({ value: String(l.location_id), label: l.location_name ? `${l.location_code} — ${l.location_name}` : String(l.location_code) }));
}

/** Every active location of the company, once per open picker: a farm has hundreds of pens, more than one list page. */
export function useCompanyLocations(enabled: boolean, companyId?: string | null) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const qs = new URLSearchParams({ isActive: 'true', limit: '1000', ...(companyId ? { companyId } : {}) });
    api
      .get(`/location?${qs}`)
      .then((res: any) => {
        if (!cancelled) setRows(Array.isArray(res) ? res : (res?.data ?? []));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, companyId]);
  return rows;
}
