import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { api } from '../src/services/api-client';
import FeedSiloDashboard from '../src/components/console/inventory/feed-silo-dashboard';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
jest.mock('../src/components/console/inventory/use-feed-farm', () => ({
  useFeedFarm: () => ({
    farmId: 'farm-1', farms: [{ farmId: 'farm-1', code: 'GRS', name: 'Grasmere', companyId: 'co-1', companyName: null }],
    isFixed: false, fixedFarm: null, loaded: true, failed: false, setFarmId: jest.fn(), retry: jest.fn(),
  }),
}));

const base = {
  houseCodes: ['GRS/SHED-003'], capacityKg: 12000, belowFeedLevelKg: 1000, aboveThresholdKg: 10800, feedInSiloItemId: 'r1', feedInSiloItemName: 'Weaner Diet R1',
  feedType: 'BULK', systemBalanceKg: 1500, lastApprovedCountKg: null, lastApprovedCountAt: null, lastFeedReceiptDate: '2026-09-20', nonKgBalance: false,
  currentDietItemId: 'r1', dailyRequirementKg: 2000, daysRemaining: 0.8, firstShortageDate: '2026-09-23', projectedNeedKg: 6000, nextDietItemId: 'r2',
  nextDietDate: '2026-09-26', siloAvailableForNextDiet: true, projectedShortfallKg: 4500, recommendedOrderKg: 6000, requisitionStatus: null,
  submissionDeadline: '2026-09-25', alert: null,
};

describe('FeedSiloDashboard', () => {
  beforeEach(() => (api.get as jest.Mock).mockReset());

  it('renders one row per silo, labels the balance System Balance and flags a silo at its Below Feed Level', async () => {
    (api.get as jest.Mock).mockResolvedValue({ success: true, data: {
      planningDate: '2026-09-23', submissionDeadline: '2026-09-25', itemNames: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
      rows: [
        { ...base, siloId: 's1', siloCode: 'GRS/SILO-001', siloName: 'Weaner silo' },
        { ...base, siloId: 's2', siloCode: 'GRS/SILO-002', siloName: 'Grower silo', systemBalanceKg: 1000, nonKgBalance: true, currentDietItemId: null, alert: 'CRITICAL_FIRST_PRIORITY' },
      ],
    } });

    render(<FeedSiloDashboard />);

    expect(await screen.findByText('GRS/SILO-001')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/feed-forecast/silo-status?farmId=farm-1');
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(screen.getByRole('columnheader', { name: 'fsdColBalance' })).toBeTruthy();
    // Code AND name beside it (Engine §4 row 49, §1 row 9; Rishi 4 Oct).
    expect(screen.getByText('Weaner silo')).toBeTruthy();
    expect(screen.getByText('Grower silo')).toBeTruthy();
    const second = document.querySelector('[data-silo-row="GRS/SILO-002"]') as HTMLElement;
    expect(within(second).getByText('fsdAlertCritical')).toBeTruthy();
    expect(within(second).getByText('fsdNonKg')).toBeTruthy();
    expect(within(document.querySelector('[data-silo-row="GRS/SILO-001"]') as HTMLElement).queryByText('fsdAlertCritical')).toBeNull();
  });

  it('says so when the farm has no silos', async () => {
    (api.get as jest.Mock).mockResolvedValue({ success: true, data: { planningDate: '2026-09-23', submissionDeadline: '2026-09-25', itemNames: {}, rows: [] } });
    render(<FeedSiloDashboard />);
    expect(await screen.findByText('fsdEmpty')).toBeTruthy();
  });
});
