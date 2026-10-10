import { BadRequestException } from '@nestjs/common';
import { feedReleaseBlockReason, groupFeedTransferLines, resolveLoadingBinId } from './feed-requisition-transfer.rules';

const lines = [
  { lineId: 'line-1', itemId: 'feed-a', itemLabel: 'FEED-A', destinationLocationId: 'silo-1', quantityKg: 5000 },
  { lineId: 'line-2', itemId: 'feed-a', itemLabel: 'FEED-A', destinationLocationId: 'silo-1', quantityKg: 3000 },
];
const assignment = {
  assignmentId: 'assignment-1', itemId: 'feed-a', productionDate: '2026-10-10',
  binLocationId: 'bin-1', productionSlotId: 'slot-1',
};

describe('groupFeedTransferLines', () => {
  it('groups lines sharing one exact assignment and destination while preserving ids and KG', () => {
    expect(groupFeedTransferLines(lines, [assignment], '2026-10-10')).toEqual([{
      assignmentId: 'assignment-1',
      sourceLocationId: 'bin-1',
      destinationLocationId: 'silo-1',
      productionSlotId: 'slot-1',
      lines: [
        { requisitionLineId: 'line-1', itemId: 'feed-a', quantityKg: 5000 },
        { requisitionLineId: 'line-2', itemId: 'feed-a', quantityKg: 3000 },
      ],
    }]);
  });

  it('splits plans when either the BIN assignment or destination SILO differs', () => {
    const result = groupFeedTransferLines([
      lines[0],
      { ...lines[1], itemId: 'feed-b', itemLabel: 'FEED-B' },
      { ...lines[1], lineId: 'line-3', destinationLocationId: 'silo-2' },
    ], [assignment, { ...assignment, assignmentId: 'assignment-2', itemId: 'feed-b', binLocationId: 'bin-2' }], '2026-10-10');
    expect(result).toHaveLength(3);
  });

  it('refuses a line with no exact-date assignment and names the item', () => {
    expect(() => groupFeedTransferLines(lines, [{ ...assignment, productionDate: '2026-10-11' }], '2026-10-10'))
      .toThrow(new BadRequestException('FEED-A has no active mill BIN assignment on 2026-10-10.'));
  });

  it('refuses ambiguous exact-date assignments and names the item', () => {
    expect(() => groupFeedTransferLines(lines, [assignment, { ...assignment, assignmentId: 'assignment-2', binLocationId: 'bin-2' }], '2026-10-10'))
      .toThrow(new BadRequestException('FEED-A has multiple active mill BIN assignments on 2026-10-10; select an unambiguous production slot.'));
  });

  it('returns the truthful disabled reason used by the header action', () => {
    expect(feedReleaseBlockReason(lines, [], '2026-10-10')).toBe('FEED-A has no active mill BIN assignment on 2026-10-10.');
    expect(feedReleaseBlockReason(lines, [assignment], '2026-10-10')).toBeNull();
    expect(feedReleaseBlockReason(lines, [assignment], null)).toBe('A production date is required before Release.');
  });
});

describe('resolveLoadingBinId', () => {
  const bins = [
    assignment,
    { ...assignment, assignmentId: 'assignment-2', itemId: 'feed-b', binLocationId: 'bin-2' },
  ];

  it('names the BIN assigned to the item on the production date, the same one Release uses', () => {
    expect(resolveLoadingBinId({ itemId: 'feed-a', productionDate: '2026-10-10' }, bins)).toBe('bin-1');
    expect(resolveLoadingBinId({ itemId: 'feed-b', productionDate: '2026-10-10' }, bins)).toBe('bin-2');
  });

  it('names no BIN rather than guessing when the assignment is missing or ambiguous', () => {
    expect(resolveLoadingBinId({ itemId: 'feed-a', productionDate: '2026-10-11' }, bins)).toBeNull();
    expect(resolveLoadingBinId({ itemId: 'feed-a', productionDate: null }, bins)).toBeNull();
    expect(resolveLoadingBinId({ itemId: 'feed-a', productionDate: '2026-10-10' }, [...bins, { ...assignment, assignmentId: 'a-3', binLocationId: 'bin-3' }])).toBeNull();
  });
});
