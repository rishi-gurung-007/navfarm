import { mapValidItemIndexesToStagedIndexes } from './MasterDataImportModal';

describe('mapValidItemIndexesToStagedIndexes', () => {
  it('maps each valid item\'s position back to its real position among all staged rows', () => {
    // staged rows: [invalid, valid(A), valid(B)] — validItems is [A, B], at positions 0 and 1
    const stagedRows = [{ isValid: false }, { isValid: true }, { isValid: true }];
    expect(mapValidItemIndexesToStagedIndexes(stagedRows)).toEqual([1, 2]);
  });

  it('is the identity when every staged row is valid', () => {
    const stagedRows = [{ isValid: true }, { isValid: true }, { isValid: true }];
    expect(mapValidItemIndexesToStagedIndexes(stagedRows)).toEqual([0, 1, 2]);
  });
});
