import { planKillSheetIntegrationFixture } from './seed-kill-sheet-integration-fixture';

describe('Kill Sheet integration fixture isolation', () => {
  it('exports its isolated planning entrypoint', () => {
    expect(planKillSheetIntegrationFixture).toBeInstanceOf(Function);
  });
});
