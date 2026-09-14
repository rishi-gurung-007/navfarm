import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import MortalityHealthPanel from '../src/components/console/production/mortality-health-panel';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../src/hooks/useAuth', () => ({ getActiveCompanyId: () => 'company-id' }));
jest.mock('../src/hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));

// Exercise panel state and posting behavior; the shared lookup and dialog have
// their own interaction tests. Keep their controlled-value contracts here.
jest.mock('../src/components/ui/dialog', () => ({
  Dialog: ({ open, title, children }: { open: boolean; title: string; children: React.ReactNode }) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));
jest.mock('../src/modules/master-data/EntityLookupField', () => ({
  EntityLookupField: ({ id, label, options, value, onChange }: {
    id: string; label: string; options: Record<string, string>[]; value: string;
    onChange: (value: string) => void;
  }) => <select id={id} aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
    <option value="">Select</option>
    {options.map(item => <option key={item.item_id} value={item.item_id}>{item.item_name}</option>)}
  </select>,
}));

const vaccine = { item_id: 'vaccine-id', item_code: 'vaccine-code', item_name: 'Selected vaccine', uom_primary: 'ML' };
const get = api.get as jest.Mock;
const post = api.post as jest.Mock;

async function openTreatment(animalIds = ['animal-one']) {
  render(<MortalityHealthPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'mhVeterinaryTreatmentsCare' }));
  fireEvent.click(screen.getByRole('button', { name: 'mhRecordTreatment' }));
  const dialog = screen.getByRole('dialog', { name: 'mhRecordVeterinaryTreatment' });
  await within(dialog).findByRole('option', { name: vaccine.item_name });
  for (const animalId of animalIds) {
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: animalId }));
  }
  fireEvent.change(within(dialog).getByRole('combobox', { name: 'mhMedicineVaccineAdministered' }), { target: { value: vaccine.item_id } });
  fireEvent.change(within(dialog).getByRole('spinbutton', { name: /Stock quantity per animal/ }), { target: { value: '2.5' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Lot number' }), { target: { value: 'selected-lot' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Dosage notes' }), { target: { value: 'Clinical dosage notes' } });
  const save = within(dialog).getByRole('button', { name: 'mhSaveTreatmentRecord' });
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
  return { dialog, save };
}

describe('MortalityHealthPanel treatment posting', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockImplementation(async (path: string) => {
      if (path.startsWith('/batch?')) return [{ batch_id: 'batch-id', batch_no: 'batch-no', opening_quantity: 2 }];
      if (path === '/batch/batch-id') return { transactions: [] };
      if (path.startsWith('/animal?')) return ['animal-one', 'animal-two'].map(animal_id => ({ animal_id, ear_tag: animal_id }));
      if (path.startsWith('/item?')) return { data: path.includes('itemType=VACCINE') ? [vaccine] : [], total: path.includes('itemType=VACCINE') ? 1 : 0 };
      return [];
    });
  });

  it('posts the explicit vaccine, stock quantity and stock UOM instead of dosage notes', async () => {
    post.mockResolvedValue({ posting_transaction_id: 'posted-one' });
    const { save } = await openTreatment();
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/batch/batch-id/transaction', expect.objectContaining({
      transaction_type: 'CONSUMPTION', item_id: 'vaccine-id', quantity: 2.5, uom: 'ML',
      lot_no: 'selected-lot', animal_id: 'animal-one', treatment_detail: expect.any(Object),
    }));
    expect(within(screen.getByRole('table')).getByText(vaccine.item_name)).toBeTruthy();
  });

  it('keeps a rejected save visible without fabricating a treatment row', async () => {
    post.mockRejectedValue(new Error('Insufficient selected-lot stock'));
    const { dialog, save } = await openTreatment();
    fireEvent.click(save);
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Insufficient selected-lot stock');
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((within(dialog).getByRole('checkbox', { name: 'animal-one' }) as HTMLInputElement).checked).toBe(true);
    expect(within(screen.getByRole('table')).queryByText(vaccine.item_name)).toBeNull();
  });

  it('does not fabricate a saved row when the response has no posting reference', async () => {
    post.mockResolvedValue({});
    const { dialog, save } = await openTreatment();
    fireEvent.click(save);
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Reload and check the register before retrying');
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(within(screen.getByRole('table')).queryByText(vaccine.item_name)).toBeNull();
  });

  it('deselects successful animals after a later failure and retries only the remainder', async () => {
    post.mockResolvedValueOnce({ posting_transaction_id: 'posted-one' })
      .mockRejectedValueOnce(new Error('Second animal failed'))
      .mockResolvedValueOnce({ posting_transaction_id: 'posted-two' });
    const { dialog, save } = await openTreatment(['animal-one', 'animal-two']);
    fireEvent.click(save);
    expect((await within(dialog).findByRole('alert')).textContent).toContain('1 animal treatment(s) saved; only remaining animals are selected. Second animal failed');
    expect((within(dialog).getByRole('checkbox', { name: 'animal-one' }) as HTMLInputElement).checked).toBe(false);
    expect((within(dialog).getByRole('checkbox', { name: 'animal-two' }) as HTMLInputElement).checked).toBe(true);
    expect(within(screen.getByRole('table')).getAllByText(vaccine.item_name)).toHaveLength(1);

    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(post.mock.calls.map(([, body]) => body.animal_id)).toEqual(['animal-one', 'animal-two', 'animal-two']);
    expect(within(screen.getByRole('table')).getAllByText(vaccine.item_name)).toHaveLength(2);
  });
});
