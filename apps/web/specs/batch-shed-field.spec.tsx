import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BatchShedField } from '../src/components/console/production/batch-shed-field';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { patch: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});

const patch = api.patch as jest.Mock;
const sheds = [
  { shed_id: 's1', shed_code: 'VIL100/SHED-001', shed_name: 'Gilt House', farm_id: 'farm-vil', is_active: true },
  { shed_id: 's2', shed_code: 'VIL100/SHED-002', shed_name: 'Dry Sow House', farm_id: 'farm-vil', is_active: true },
  { shed_id: 'x1', shed_code: 'LEX100/SHED-001', shed_name: 'Weaner House', farm_id: 'farm-lex', is_active: true },
];

describe('BatchShedField (D21)', () => {
  beforeEach(() => patch.mockReset());

  it('offers the sheds of the batch farm only and saves a new choice', async () => {
    patch.mockResolvedValue({ data: { batch_id: 'b1', shed_id: 's2', farm_id: 'farm-vil' } });
    const onSaved = jest.fn();
    render(<BatchShedField batch={{ batch_id: 'b1', status: 'ACTIVE', shed_id: null, farm_id: 'farm-vil' }} sheds={sheds} onSaved={onSaved} />);
    const select = screen.getByLabelText('blShed') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['blNoShed', 'VIL100/SHED-001 — Gilt House', 'VIL100/SHED-002 — Dry Sow House']);
    const save = screen.getByRole('button', { name: 'blSaveShed' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(select, { target: { value: 's2' } });
    fireEvent.click(save);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/batch/b1/shed', { shed_id: 's2' }));
    expect(onSaved).toHaveBeenCalledWith('s2');
  });

  it('shows the API refusal and keeps the choice', async () => {
    patch.mockRejectedValue({ message: 'That shed is on another farm.' });
    render(<BatchShedField batch={{ batch_id: 'b1', status: 'ACTIVE', shed_id: null, farm_id: 'farm-vil' }} sheds={sheds} onSaved={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('blShed'), { target: { value: 's1' } });
    fireEvent.click(screen.getByRole('button', { name: 'blSaveShed' }));
    expect(await screen.findByText('That shed is on another farm.')).toBeTruthy();
  });

  it('is read-only on a closed batch', () => {
    render(<BatchShedField batch={{ batch_id: 'b1', status: 'CLOSED', shed_id: 's1', farm_id: 'farm-vil' }} sheds={sheds} onSaved={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'blSaveShed' })).toBeNull();
    expect(screen.getByText('VIL100/SHED-001 — Gilt House')).toBeTruthy();
  });
});
