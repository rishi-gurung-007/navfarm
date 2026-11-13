import {
  animalScanValue,
  labelFileName,
  parseScannedCode,
  recentScanEvents,
} from '../src/components/console/piggery/animal-scan-code';

describe('animal scan codes', () => {
  it('encodes the animal code alone, trimmed', () => {
    expect(animalScanValue({ animal_code: ' PIG-2026-00012 ' })).toBe('PIG-2026-00012');
    expect(animalScanValue({})).toBe('');
  });

  it('reads back what a USB scanner types, without its prefix or suffix characters', () => {
    expect(parseScannedCode('PIG-2026-00012\r\n')).toBe('PIG-2026-00012');
    expect(parseScannedCode('\u001dPIG-2026-00012\t')).toBe('PIG-2026-00012');
    expect(parseScannedCode('   ')).toBe('');
    expect(parseScannedCode(null)).toBe('');
  });

  it('takes the code out of a link to the scan screen', () => {
    expect(parseScannedCode('https://farm.example/livestock/scan?code=PIG-2026-00012')).toBe(
      'PIG-2026-00012',
    );
    // A link without a code is looked up as typed and simply not found.
    expect(parseScannedCode('https://farm.example/livestock')).toBe('https://farm.example/livestock');
  });

  it('names a downloaded label after the code', () => {
    expect(labelFileName('PIG-2026-00012')).toBe('PIG-2026-00012-label.png');
    expect(labelFileName('A/B C')).toBe('A_B_C-label.png');
    expect(labelFileName('///')).toBe('animal-label.png');
  });
});

describe('recentScanEvents', () => {
  it('lists her matings, farrowings, transfers, entry and exit newest first, capped', () => {
    const events = recentScanEvents(
      { entry_date: '2026-01-05', entry_type: 'PURCHASED_LOCAL', disposal_date: null },
      {
        matings: [{ breeding_id: 'b1', role: 'DAM', boar_code: 'BOAR-1', mating_type: 'AI', mating_date: '2026-03-01', parity_number: 1 }],
        farrowings: [{ farrow_id: 'f1', farrowing_date: '2026-06-23', piglets_born_live: 11, piglets_weaned: 10, parity_number: 1 }],
        transfers: [{ transfer_id: 't1', transfer_date: '2026-06-01', to_pen_code: 'PEN-2', transfer_no: 'TR-1' }],
      },
    );
    expect(events.map((e) => e.title)).toEqual([
      'Farrowed 11 born live',
      'Moved to PEN-2',
      'Served by BOAR-1',
      'Entered the herd',
    ]);
    expect(events[0].detail).toBe('parity 1 · 10 weaned');
    expect(events[3].detail).toBe('purchased local');
    expect(recentScanEvents({ entry_date: '2026-01-05' }, null, 1)).toHaveLength(1);
  });

  it('tells a boar his services from his side', () => {
    const [e] = recentScanEvents({}, { matings: [{ breeding_id: 'b', role: 'SIRE', sow_code: 'SOW-9', mating_date: '2026-02-02' }] });
    expect(e.title).toBe('Served SOW-9');
  });
});
