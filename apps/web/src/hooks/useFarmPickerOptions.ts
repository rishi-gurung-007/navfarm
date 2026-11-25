'use client';

import { useEffect, useState } from 'react';
import { api } from '@/services/api-client';
import { getActiveWorkspaceScope } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

export interface FarmPickerOption {
  location_id: string;
  location_code: string;
  location_name: string;
  company_id?: string | null;
}

const LOCATION_FARMS =
  '/location?locationType=FARM&rootOnly=true&isActive=true&limit=100';

const rowsOf = (res: any): any[] =>
  (Array.isArray(res) ? res : res?.data) || [];

const fromLocations = async (): Promise<FarmPickerOption[]> =>
  rowsOf(await api.get(LOCATION_FARMS));

/**
 * The tenant-wide workspace's location master holds no company farms, so there the farms are read from the Farrowing
 * Report's list (only a tenant administrator works there, who may read it). Everyone else keeps the location master.
 */
async function loadFarms(): Promise<FarmPickerOption[]> {
  if (getActiveWorkspaceScope() !== 'TENANT') return fromLocations();
  try {
    return rowsOf(await api.get('/reports/farrowing/farms')).map((f) => ({
      location_id: f.farm_id,
      location_code: f.farm_code,
      location_name: f.farm_name,
      company_id: f.company_id,
    }));
  } catch {
    return fromLocations();
  }
}

/**
 * The options of a list page's farm filter. `companyId` is the company the page asks its records for: another company's
 * farm would list nothing, so it is left out. The farm in force, and the one a link arrived with, are always offered,
 * so the filter shows what it is doing and can be set to All Farms and back.
 */
export function useFarmPickerOptions(
  selectedFarmId: string,
  linkedFarmId: string,
  companyId?: string | null,
): FarmPickerOption[] {
  const { t } = useLanguage();
  const [farms, setFarms] = useState<FarmPickerOption[]>([]);

  useEffect(() => {
    loadFarms()
      .then(setFarms)
      .catch(() => void 0);
  }, []);

  const options = farms.filter(
    (f) => !companyId || !f.company_id || f.company_id === companyId,
  );
  for (const id of new Set([linkedFarmId, selectedFarmId])) {
    if (!id || options.some((f) => f.location_id === id)) continue;
    options.push(
      farms.find((f) => f.location_id === id) ?? {
        location_id: id,
        location_code: '',
        location_name: t('farmPickerUnlisted'),
      },
    );
  }
  return options;
}
