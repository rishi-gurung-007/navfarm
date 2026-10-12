import React from 'react';
import { render, screen } from '@testing-library/react';
import { FeedForecastNotes, buildNoteGroups, type ForecastFlag } from '../src/components/console/inventory/feed-forecast-notes';

const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

describe('feed forecast notes — grouped by kind, with counts (review C)', () => {
  const flags: ForecastFlag[] = [
    { kind: 'NO_FEED_ROW', batchNo: 'BATCH-1', stageCode: 'WEANER', day: 30, date: '2026-09-27' },
    { kind: 'NO_FEED_ROW', batchNo: 'BATCH-1', stageCode: 'WEANER', day: 31, date: '2026-09-28' },
    { kind: 'NO_FEED_ROW', batchNo: 'BATCH-1', stageCode: 'WEANER', day: 31, date: '2026-09-28' },
    { kind: 'NO_FEED_ROW', batchNo: 'BATCH-1', stageCode: 'WEANER', day: 32, date: '2026-09-29' },
    { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'BATCH-000012' },
    { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'BATCH-000013' },
    { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'BATCH-000012' },
    { kind: 'HEADS_ASSUMED_FLAT', batchNo: 'BATCH-000012' },
    { kind: 'HEADS_ASSUMED_FLAT', batchNo: 'BATCH-000013' },
  ];

  it('folds a run of days into one item, dedupes repeats, and lists each shedless batch once', () => {
    const groups = buildNoteGroups(flags, t);
    expect(groups.map((g) => [g.kind, g.items.length])).toEqual([['NO_FEED_ROW', 1], ['BATCH_SHED_UNKNOWN', 2], ['HEADS_ASSUMED_FLAT', 1]]);
    expect(groups[0].items[0]).toBe('ffNoteDayRange:{"batchNo":"BATCH-1","stageCode":"WEANER","days":"30–32","dates":"27/09/26–29/09/26"}');
    expect(groups[1].items).toEqual(['BATCH-000012', 'BATCH-000013']);
  });

  it('is one collapsed panel whose summary counts each kind, and renders nothing without flags', () => {
    const { container, rerender } = render(<FeedForecastNotes flags={flags} t={t} />);
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(screen.getByText('ffNotesTitle:{"count":3}')).toBeTruthy();
    expect(details.querySelector('summary')!.textContent).toContain('ffNoteNoFeedRow (1)');
    expect(details.querySelector('summary')!.textContent).toContain('ffNoteNoShed (2)');
    rerender(<FeedForecastNotes flags={[]} t={t} />);
    expect(container.innerHTML).toBe('');
  });

  it('names a silo whose ledger balance was below zero, with the figure and the date', () => {
    const groups = buildNoteGroups([
      { kind: 'NEGATIVE_SYSTEM_BALANCE', sourceCode: 'MUL100/SILO-004', itemName: 'Grower', balanceKg: -471.74, date: '2026-10-10' },
      { kind: 'NEGATIVE_SYSTEM_BALANCE', sourceCode: 'MUL100/SILO-004', itemName: 'Grower', balanceKg: -471.74, date: '2026-10-10' },
    ], t);
    expect(groups).toEqual([{
      kind: 'NEGATIVE_SYSTEM_BALANCE', title: 'ffNoteNegativeBalance',
      items: ['ffNoteNegativeBalanceItem:{"sourceCode":"MUL100/SILO-004","itemName":"Grower","kg":"-471.74","date":"10/10/26"}'],
    }]);
  });

  it('writes the negative-balance note in plain words', () => {
    const { translations } = require('../src/utils/translations');
    const text = translations.en.ffNoteNegativeBalanceItem.replace('{{sourceCode}}', 'MUL100/SILO-004').replace('{{kg}}', '-471.74').replace('{{date}}', '10/10/26');
    expect(text).toContain('MUL100/SILO-004');
    expect(text).toContain('-471.74 KG');
    expect(text).toMatch(/used before it was received/);
  });
});
