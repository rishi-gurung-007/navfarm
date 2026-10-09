import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import FeedForecastTabs, {
  FEED_FORECAST_TABS,
  feedForecastTabQuery,
  readFeedForecastTab,
} from '../src/components/console/inventory/feed-forecast-tabs';

// Mount counters live inside the mock factories (jest allows only `mock*`
// `var`s there — it rejects `let`/`const` as out-of-scope), so a panel that
// mounts twice is visible from the test.
/* eslint-disable no-var */
var mockForecastMounts = 0;
var mockCountMounts = 0;
/* eslint-enable no-var */

jest.mock('../src/components/console/inventory/feed-forecast-panel', () => {
  const { useEffect, useState } = jest.requireActual('react');
  const { useFeedForecastContext } = jest.requireActual('../src/components/console/inventory/feed-forecast-context');
  return {
    __esModule: true,
    default: function MockForecast() {
      const [bumps, setBumps] = useState(0);
      const forecast = useFeedForecastContext();
      // Mount only: the function itself runs on every render.
      useEffect(() => {
        mockForecastMounts += 1;
      }, []);
      return (
        <div data-testid="panel-forecast">
          <span data-testid="forecast-bumps">{bumps}</span>
          <span data-testid="forecast-view">{forecast.view}</span>
          <button type="button" onClick={() => setBumps((n) => n + 1)}>bump</button>
          <button type="button" onClick={() => forecast.setView('WEEKLY')}>weekly-shared</button>
        </div>
      );
    },
  };
});
jest.mock('../src/components/console/inventory/requisitions-panel', () => ({
  __esModule: true,
  FeedRequisitionPanel: () => <div data-testid="panel-requisition" />,
  default: () => <div data-testid="panel-requisition" />,
}));
jest.mock('../src/components/console/inventory/feed-plan-panel', () => ({
  __esModule: true,
  default: () => <div data-testid="panel-feed-plan" />,
}));
jest.mock('../src/components/console/inventory/feed-stock-count-panel', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    __esModule: true,
    default: function MockCount() {
      useEffect(() => {
        mockCountMounts += 1;
      }, []);
      return <div data-testid="panel-count" />;
    },
  };
});
jest.mock('../src/components/console/inventory/feed-silo-dashboard', () => {
  const { useFeedForecastContext } = jest.requireActual('../src/components/console/inventory/feed-forecast-context');
  return {
    __esModule: true,
    default: function MockDashboard() {
      const forecast = useFeedForecastContext();
      return <div data-testid="panel-dashboard"><span data-testid="dashboard-view">{forecast.view}</span></div>;
    },
  };
});
jest.mock('../src/components/console/inventory/use-feed-farm', () => ({
  useFeedFarm: () => ({
    farmId: 'farm-1', setFarmId: jest.fn(), retry: jest.fn(), farms: [], loaded: true,
    failed: false, isFixed: false, fixedFarm: null,
  }),
}));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});

const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
/** The wrapper each panel sits in; that element carries the show/hide style. */
const displayOf = (tab: string) => document.querySelector(`[data-feed-tab="${tab}"]`)!.getAttribute('style') ?? '';

describe('Feed Forecast tab selection is carried by the URL', () => {
  it('reads each supported tab and falls back to the forecast for anything else', () => {
    expect(FEED_FORECAST_TABS).toEqual(['dashboard', 'forecast', 'feed-plan', 'feed-requisition', 'mill-consolidation', 'loading-instructions', 'physical-count']);
    expect(readFeedForecastTab('dashboard')).toBe('dashboard');
    expect(readFeedForecastTab('forecast')).toBe('forecast');
    expect(readFeedForecastTab('feed-plan')).toBe('feed-plan');
    expect(readFeedForecastTab('feed-requisition')).toBe('feed-requisition');
    expect(readFeedForecastTab('mill-consolidation')).toBe('mill-consolidation');
    expect(readFeedForecastTab('loading-instructions')).toBe('loading-instructions');
    expect(readFeedForecastTab('physical-count')).toBe('physical-count');
    expect(readFeedForecastTab(null)).toBe('forecast');
    expect(readFeedForecastTab(undefined)).toBe('forecast');
    expect(readFeedForecastTab('')).toBe('forecast');
    expect(readFeedForecastTab('not-a-tab')).toBe('forecast');
  });

  it('builds the query the old feed-requisitions redirect lands on', () => {
    expect(feedForecastTabQuery('feed-requisition')).toBe('tab=feed-requisition');
    expect(readFeedForecastTab(new URLSearchParams(feedForecastTabQuery('feed-requisition')).get('tab')))
      .toBe('feed-requisition');
  });
});

describe('FeedForecastTabs', () => {
  beforeEach(() => {
    mockForecastMounts = 0;
    mockCountMounts = 0;
  });

  it('shows all seven tabs and marks the selected one', () => {
    render(<FeedForecastTabs tab="forecast" onTabChange={() => undefined} />);
    const list = screen.getByRole('tablist');
    expect(Array.from(list.querySelectorAll('[role="tab"]')).map((node) => node.textContent))
      .toEqual(['fftTabDashboard', 'fftTabForecast', 'fftTabFeedPlan', 'fftTabFeedRequisition', 'invFeedConsolidations', 'invFeedLoading', 'fftTabPhysicalCount']);
    expect(screen.getByRole('tab', { name: 'fftTabForecast' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'fftTabPhysicalCount' }).getAttribute('aria-selected')).toBe('false');
  });

  it('asks for the requested tab and shows only that panel', () => {
    render(<FeedForecastTabs tab="physical-count" onTabChange={() => undefined} />);
    expect(screen.getByTestId('panel-count')).toBeTruthy();
    expect(screen.queryByTestId('panel-forecast')).toBeNull();
    expect(displayOf('physical-count')).not.toBe('none');
  });

  it('hands a tab click to the owner so the URL, not this component, holds it', () => {
    const onTabChange = jest.fn();
    render(<FeedForecastTabs tab="forecast" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'fftTabPhysicalCount' }));
    expect(onTabChange).toHaveBeenCalledWith('physical-count');
  });

  it('keeps a panel mounted once so its state survives switching away and back', () => {
    const { rerender } = render(<FeedForecastTabs tab="forecast" onTabChange={() => undefined} />);
    expect(mockForecastMounts).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'bump' }));
    expect(screen.getByTestId('forecast-bumps').textContent).toBe('1');

    // Away to Physical Count: the forecast stays mounted, just hidden.
    rerender(<FeedForecastTabs tab="physical-count" onTabChange={() => undefined} />);
    expect(mockCountMounts).toBe(1);
    expect(displayOf('physical-count')).not.toContain('none');
    expect(screen.getByTestId('forecast-bumps').textContent).toBe('1');
    expect(displayOf('forecast')).toContain('none');

    // …and back: no second mount, and the value it held is still there.
    rerender(<FeedForecastTabs tab="forecast" onTabChange={() => undefined} />);
    expect(mockForecastMounts).toBe(1);
    expect(screen.getByTestId('forecast-bumps').textContent).toBe('1');
  });

  it('provides one shared forecast window to Dashboard and Calculation', () => {
    const { rerender } = render(<FeedForecastTabs tab="forecast" onTabChange={() => undefined} />);
    expect(screen.getByTestId('forecast-view').textContent).toBe('CUSTOM');
    fireEvent.click(screen.getByRole('button', { name: 'weekly-shared' }));
    rerender(<FeedForecastTabs tab="dashboard" onTabChange={() => undefined} />);
    expect(screen.getByTestId('dashboard-view').textContent).toBe('WEEKLY');
  });

  it('does not mount a tab that was never opened', () => {
    render(<FeedForecastTabs tab="forecast" onTabChange={() => undefined} />);
    expect(screen.queryByTestId('panel-requisition')).toBeNull();
    expect(screen.queryByTestId('panel-count')).toBeNull();
  });

  it('renders no farm picker of its own: the shared hook is the one farm context', () => {
    const source = read('src/components/console/inventory/feed-forecast-tabs.tsx');
    expect(source).not.toContain('FeedFarmSelect');
    expect(source).not.toMatch(/^\s*import .*useFeedFarm/m);
  });
});

describe('the feed screens read the shared farm selection', () => {
  it.each([
    'src/components/console/inventory/requisitions-panel.tsx',
    'src/components/console/inventory/feed-stock-count-panel.tsx',
  ])('%s keeps using the compatible shared farm hook', (path) => {
    expect(read(path)).toContain('useFeedFarm()');
  });
});

/**
 * WP1d (Rishi 4 Oct, final; he asked again on 5 Oct why the old names were
 * still showing): the Feed Forecast tabs take the workbook's names —
 * Dashboard · Calculation · Feed Plan · Requisition · Mill Consolidation ·
 * Loading Instructions · Physical Stock Count, in that order.
 * The routes keep their existing `?tab=` keys, because they are bookmarks.
 */
describe("WP1d — Feed Forecast tab names follow the workbook", () => {
  it("names the seven tabs in order without renaming any route key", () => {
    expect(FEED_FORECAST_TABS).toEqual(["dashboard", "forecast", "feed-plan", "feed-requisition", "mill-consolidation", "loading-instructions", "physical-count"]);
    const en = (require("../src/utils/translations") as any).translations.en;
    expect([
      en.fftTabDashboard, en.fftTabForecast, en.fftTabFeedPlan, en.fftTabFeedRequisition, en.invFeedConsolidations, en.invFeedLoading, en.fftTabPhysicalCount,
    ]).toEqual(["Dashboard", "Calculation", "Feed Plan", "Requisition", "Feed Mill Consolidation", "Feed Loading Instructions", "Physical Stock Count"]);
  });
});
