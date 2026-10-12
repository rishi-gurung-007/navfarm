import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { FeedSiloDashboardCharts, prepareBalanceSeries } from '../src/components/console/inventory/feed-silo-dashboard-charts';

jest.mock('../src/hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));

const balances = [
  { date: '2026-10-07', itemId: 'r1', itemName: 'Diet R1', openingKg: 500, confirmedReceiptKg: 0, demandKg: 500, closingKg: 0 },
  { date: '2026-10-05', itemId: 'r1', itemName: 'Diet R1', openingKg: 1500, confirmedReceiptKg: 0, demandKg: 500, closingKg: 1000 },
  { date: '2026-10-06', itemId: 'r1', itemName: 'Diet R1', openingKg: 1000, confirmedReceiptKg: 0, demandKg: 500, closingKg: 500 },
];
const demand = [
  { date: '2026-10-05', currentDietKg: 500, nextDietKg: 0 },
  { date: '2026-10-06', currentDietKg: 250, nextDietKg: 250 },
];

describe('FeedSiloDashboardCharts', () => {
  it('sorts points chronologically and marks the first zero closing balance', () => {
    expect(prepareBalanceSeries(balances)).toEqual([
      expect.objectContaining({ date: '2026-10-05', runDown: false }),
      expect.objectContaining({ date: '2026-10-06', runDown: false }),
      expect.objectContaining({ date: '2026-10-07', runDown: true }),
    ]);
  });

  it('renders threshold/capacity evidence, a zero marker, and current/next legend with text equivalents', () => {
    render(<FeedSiloDashboardCharts balanceSeries={balances} demandSeries={demand} belowFeedLevelKg={400} aboveThresholdKg={1100} capacityKg={1200} />);

    expect(screen.getByText('fsdProjectedBalanceChart')).toBeTruthy();
    expect(screen.getByText('fsdDietDemandChart')).toBeTruthy();
    expect(screen.getByText('fsdBelowFeedLevel')).toBeTruthy();
    expect(screen.getByText('fsdAboveThreshold')).toBeTruthy();
    expect(screen.getByText('fsdCapacity')).toBeTruthy();
    expect(screen.getByText('fsdRunDown')).toBeTruthy();
    expect(screen.getAllByText('fsdCurrentDietDemand').length).toBeGreaterThan(0);
    expect(screen.getAllByText('fsdNextDietDemand').length).toBeGreaterThan(0);
    const balanceTable = screen.getByRole('table', { name: 'fsdProjectedBalanceData' });
    expect(within(balanceTable).getAllByRole('row')).toHaveLength(4);
  });

  it('shows an explicit unavailable state when no chart series exist', () => {
    render(<FeedSiloDashboardCharts balanceSeries={[]} demandSeries={[]} belowFeedLevelKg={null} aboveThresholdKg={null} capacityKg={null} />);
    expect(screen.getAllByText('fsdChartUnavailable')).toHaveLength(2);
  });
});
