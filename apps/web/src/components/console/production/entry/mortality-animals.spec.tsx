import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  OTHER_REASON,
  filterMortalityCandidates,
  mortalityPayload,
  mortalityPicksComplete,
  requiredMortalityAnimals,
  type MortalityPick,
} from './mortality-animals';
import { MortalityAnimalsField } from './mortality-animals-field';

// The screen's own English strings, so the assertions read what the user reads.
jest.mock('@/hooks/useLanguage', () => {
  const { translations } = jest.requireActual('@/utils/translations');
  const t = (key: string, vars?: Record<string, string>) =>
    String((translations.en as Record<string, string>)[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, n) => vars?.[n] ?? '');
  return { useLanguage: () => ({ t }) };
});
jest.mock('@/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('@/hooks/useReasons', () => ({
  useReasons: () => ({
    loading: false,
    reasons: [{ reason_id: 'r-1', reason_code: 'MRT-001', reason_name: 'Respiratory disease', category: 'MORTALITY' }],
  }),
}));

const animals = [
  { animal_id: 'a-1', animal_code: 'PIG-0001', rfid_tag: 'TAG-77' },
  { animal_id: 'a-2', animal_code: 'PIG-0002', rfid_tag: null },
  { animal_id: 'a-3', animal_code: 'PIG-0003', rfid_tag: null },
];
const pick = (over: Partial<MortalityPick> = {}): MortalityPick => ({ animal_id: 'a-1', dead_weight_kg: '18.5', reason_id: 'r-1', reason_text: '', ...over });

describe('mortality animals rules', () => {
  it('asks for the deaths the entry adds, capped at the registered animals alive', () => {
    expect(requiredMortalityAnimals(2, 0, 10)).toBe(2);
    expect(requiredMortalityAnimals(5, 0, 3)).toBe(3); // a batch registered in part
    expect(requiredMortalityAnimals(3, 1, 10)).toBe(2); // a correction names only the extra animals
    expect(requiredMortalityAnimals(1, 2, 10)).toBe(0); // downward: no deaths added
    expect(requiredMortalityAnimals(2, 0, 0)).toBe(0); // count-only batch
  });

  it('is complete only with exactly N animals, each with weight above 0 and a reason', () => {
    expect(mortalityPicksComplete([pick()], 1)).toBe(true);
    expect(mortalityPicksComplete([], 1)).toBe(false);
    expect(mortalityPicksComplete([pick(), pick({ animal_id: 'a-2' })], 1)).toBe(false);
    expect(mortalityPicksComplete([pick({ dead_weight_kg: '' })], 1)).toBe(false);
    expect(mortalityPicksComplete([pick({ dead_weight_kg: '0' })], 1)).toBe(false);
    expect(mortalityPicksComplete([pick({ reason_id: '' })], 1)).toBe(false);
    expect(mortalityPicksComplete([pick({ reason_id: OTHER_REASON, reason_text: '  ' })], 1)).toBe(false);
    expect(mortalityPicksComplete([pick({ reason_id: OTHER_REASON, reason_text: 'Crushed' })], 1)).toBe(true);
  });

  it('sends a master reason by id or the typed one as text, never both', () => {
    expect(mortalityPayload([pick(), pick({ animal_id: 'a-2', dead_weight_kg: '20', reason_id: OTHER_REASON, reason_text: ' Crushed ' })])).toEqual([
      { animal_id: 'a-1', dead_weight_kg: 18.5, reason_id: 'r-1' },
      { animal_id: 'a-2', dead_weight_kg: 20, reason_text: 'Crushed' },
    ]);
  });

  it('searches by tag or animal ID', () => {
    expect(filterMortalityCandidates(animals, 'tag-77').map((a) => a.animal_id)).toEqual(['a-1']);
    expect(filterMortalityCandidates(animals, '0003').map((a) => a.animal_id)).toEqual(['a-3']);
    expect(filterMortalityCandidates(animals, '')).toHaveLength(3);
  });
});

describe('MortalityAnimalsField', () => {
  const Harness = ({ required, onPicks }: { required: number; onPicks?: (p: MortalityPick[]) => void }) => {
    const [picks, setPicks] = React.useState<MortalityPick[]>([]);
    return (
      <MortalityAnimalsField
        animals={animals}
        required={required}
        picks={picks}
        onChange={(next) => {
          setPicks(next);
          onPicks?.(next);
        }}
      />
    );
  };

  it('shows nothing when the entry adds no deaths (count-only or no change)', () => {
    const { container } = render(<Harness required={0} />);
    expect(container.innerHTML).toBe('');
  });

  it('lets exactly N animals be chosen, then takes weight and a reason for each', () => {
    let latest: MortalityPick[] = [];
    render(<Harness required={2} onPicks={(p) => (latest = p)} />);
    expect(screen.getByTestId('mortality-animals-button').textContent).toContain('0/2');
    fireEvent.click(screen.getByTestId('mortality-animals-button'));

    fireEvent.click(screen.getByLabelText(/PIG-0001/));
    fireEvent.click(screen.getByLabelText(/PIG-0002/));
    // the third is not selectable once N are chosen
    expect((screen.getByLabelText(/PIG-0003/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('mortality-progress').textContent).toContain('2 of 2');
    expect(mortalityPicksComplete(latest, 2)).toBe(false);

    fireEvent.change(screen.getByLabelText('PIG-0001 - Dead weight (kg)'), { target: { value: '18.5' } });
    fireEvent.change(screen.getByLabelText('PIG-0002 - Dead weight (kg)'), { target: { value: '21' } });
    expect(latest.map((p) => p.dead_weight_kg)).toEqual(['18.5', '21']);
  });

  it('narrows the list by tag', () => {
    render(<Harness required={1} />);
    fireEvent.click(screen.getByTestId('mortality-animals-button'));
    fireEvent.change(screen.getByLabelText('Search by tag or animal ID'), { target: { value: 'tag-77' } });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/PIG-0001/)).toBeTruthy();
    expect(within(dialog).queryByLabelText(/PIG-0002/)).toBeNull();
  });

  it('reveals a text field when "Other" is the reason', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <MortalityAnimalsField animals={animals} required={1} picks={[pick({ reason_id: 'r-1' })]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('mortality-animals-button'));
    expect(screen.queryByLabelText('PIG-0001 - Type the reason')).toBeNull();
    rerender(
      <MortalityAnimalsField animals={animals} required={1} picks={[pick({ reason_id: OTHER_REASON })]} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText('PIG-0001 - Type the reason'), { target: { value: 'Crushed by sow' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ reason_id: OTHER_REASON, reason_text: 'Crushed by sow' })]);
  });
});
