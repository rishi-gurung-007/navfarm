import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api } from '../src/services/api-client';
import FeedSiloDashboard from '../src/components/console/inventory/feed-silo-dashboard';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
const mockSetFarmId = jest.fn();
jest.mock('../src/components/console/inventory/use-feed-farm', () => ({
  useFeedFarm: () => ({
    farmId: 'farm-1', farms: [{ farmId: 'farm-1', code: 'GRS', name: 'Grasmere', companyId: 'co-1', companyName: null }],
    isFixed: false, fixedFarm: null, loaded: true, failed: false, setFarmId: mockSetFarmId, retry: jest.fn(),
  }),
}));

const sheds = [
  { id: 'shed-a', code: 'GRS/SHED-001', name: 'First shed' },
  { id: 'shed-b', code: 'GRS/SHED-002', name: 'Second shed' },
];
const siloA = { id: 'silo-a', code: 'GRS/SILO-001', name: 'First silo' };
const siloB = { id: 'silo-b', code: 'GRS/SILO-002', name: 'Second silo' };
const baseResponse = {
  planningDate: '2026-10-05', today: '2026-10-05', timeZone: 'Africa/Harare', view: 'CUSTOM',
  from: '2026-10-05', to: '2026-10-11', period: null,
  farm: { id: 'farm-1', code: 'GRS', name: 'Grasmere' },
  submissionDeadline: null, silo: null, balanceSeries: [], demandSeries: [], farmTotalOrderKg: 0,
};
const selectedSilo = {
  siloId: 'silo-a', siloCode: 'GRS/SILO-001', siloName: 'First silo', houseCodes: ['GRS/SHED-001'],
  capacityKg: 12000, belowFeedLevelKg: 1000, aboveThresholdKg: 10800, feedInSiloItemId: 'r1', feedInSiloItemName: 'Diet R1',
  feedType: 'BULK', systemBalanceKg: 1500, lastApprovedCountKg: 1490, lastApprovedCountAt: '2026-10-04T10:00:00Z',
  lastFeedReceiptDate: '2026-10-03', nonKgBalance: false, currentDietItemId: 'r1', currentDietItemName: 'Diet R1',
  dailyRequirementKg: 500, daysRemaining: 3, firstShortageDate: '2026-10-08', projectedNeedKg: 3500,
  currentProjectedNeedKg: 2000, nextProjectedNeedKg: 1500, currentDietDaysRemaining: 2,
  nextDietItemId: 'r2', nextDietItemName: 'Diet R2', nextDietDate: '2026-10-07', siloAvailableForNextDiet: true,
  projectedShortfallKg: 2000, recommendedOrderKg: 3000, requisitionId: 'req-1', requisitionStatus: 'DRAFT',
  submissionDeadline: '2026-10-06', alert: null, millLoadingBin: null,
};

function response(shedId: string | null, siloId: string | null) {
  const linked = shedId === 'shed-b' ? [siloB] : [siloA];
  return {
    success: true,
    data: {
      ...baseResponse,
      selection: { shedId, siloId, sheds, silos: shedId ? linked : [] },
      ...(siloId ? {
        submissionDeadline: '2026-10-06',
        silo: { ...selectedSilo, siloId, siloCode: linked[0].code, siloName: linked[0].name },
        farmTotalOrderKg: 9000,
      } : {}),
    },
  };
}

function route(url: string) {
  const query = new URL(url, 'http://navfarm.local').searchParams;
  return Promise.resolve(response(query.get('shedId'), query.get('siloId')));
}

describe('FeedSiloDashboard', () => {
  beforeEach(() => {
    mockSetFarmId.mockReset();
    (api.get as jest.Mock).mockReset().mockImplementation(route);
  });

  it('provides a contained vertical scroller for its cards and charts', async () => {
    render(<FeedSiloDashboard />);

    await screen.findAllByText('fsdCurrentDietFeedItem');
    const dashboard = screen.getByLabelText('fsdShed').closest('[data-fill-body]');

    expect(dashboard?.classList.contains('overflow-y-auto')).toBe(true);
    expect(dashboard?.classList.contains('overscroll-contain')).toBe(true);
  });

  it('selects the first valid Shed and Silo by API code order before requesting facts', async () => {
    render(<FeedSiloDashboard />);

    await screen.findAllByText('fsdCurrentDietFeedItem');
    const calls = (api.get as jest.Mock).mock.calls.map(([url]) => String(url));
    expect(calls).toHaveLength(3);
    expect(calls[0]).not.toContain('shedId=');
    expect(calls[1]).toContain('shedId=shed-a');
    expect(calls[1]).not.toContain('siloId=');
    expect(calls[2]).toContain('shedId=shed-a');
    expect(calls[2]).toContain('siloId=silo-a');
    expect((screen.getByLabelText('fsdShed') as HTMLSelectElement).value).toBe('shed-a');
    expect((screen.getByLabelText('fsdSilo') as HTMLSelectElement).value).toBe('silo-a');
  });

  it('clears the old Silo immediately and selects the first linked Silo after a Shed change', async () => {
    render(<FeedSiloDashboard />);
    await screen.findAllByText('fsdCurrentDietFeedItem');

    fireEvent.change(screen.getByLabelText('fsdShed'), { target: { value: 'shed-b' } });
    expect(screen.queryByText('GRS/SILO-001')).toBeNull();
    await waitFor(() => expect((screen.getByLabelText('fsdSilo') as HTMLSelectElement).value).toBe('silo-b'));
    expect(await screen.findByText('GRS/SILO-002')).toBeTruthy();
  });

  it('ignores an older selected-Silo response after the parent Shed changes', async () => {
    render(<FeedSiloDashboard />);
    await screen.findAllByText('fsdCurrentDietFeedItem');
    let resolveOld!: (value: unknown) => void;
    const oldRequest = new Promise((resolve) => { resolveOld = resolve; });
    (api.get as jest.Mock).mockImplementationOnce(() => oldRequest).mockImplementation(route);

    fireEvent.change(screen.getByLabelText('fsdPlanningDate'), { target: { value: '2026-10-06' } });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4));
    fireEvent.change(screen.getByLabelText('fsdShed'), { target: { value: 'shed-b' } });
    await screen.findByText('GRS/SILO-002');
    resolveOld(response('shed-a', 'silo-a'));

    await waitFor(() => expect((screen.getByLabelText('fsdSilo') as HTMLSelectElement).value).toBe('silo-b'));
    expect(screen.queryByText('GRS/SILO-001')).toBeNull();
  });

  it('shows all approved fields, keeps Farm Total explicit, and links Silo and Requisition', async () => {
    render(<FeedSiloDashboard />);
    const table = await screen.findByRole('table', { name: 'fsdLabel' });
    const labels = [
      'fsdCurrentDietFeedItem', 'fsdMillLoadingBin', 'fsdSiloCapacityKg', 'fsdSystemBalanceKg',
      'fsdDailyRequirementKg', 'fsdDaysFeedRemaining', 'fsdProjectedNeedRangeKg', 'fsdCurrentDietDaysRemaining',
      'fsdNextDietFeedItem', 'fsdSiloAvailableNextDiet', 'fsdProjectedShortfallKg', 'fsdRecommendedOrderKg',
      'fsdFarmTotalOrderKg', 'fsdRequisitionStatus', 'fsdSubmissionDeadline',
    ];
    for (const label of labels) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(screen.getAllByText('fsdNotScheduled').length).toBeGreaterThan(0);
    expect(screen.getAllByText('9,000').length).toBeGreaterThan(0);
    expect(within(table).getByRole('link', { name: 'GRS/SILO-001' }).getAttribute('href')).toContain('recordId=silo-a');
    expect(within(table).getByRole('link', { name: 'DRAFT' }).getAttribute('href')).toContain('/requisitions?id=req-1');
  });
});
