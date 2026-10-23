import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AnimalDetailsModal from '../src/components/console/piggery/animal-details-modal';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  api: {
    get: jest.fn(),
    put: jest.fn(),
  },
}));

jest.mock('../src/hooks/useAuth', () => ({
  getStoredUser: () => ({ userType: 'TENANT_ADMIN' }),
  hasPermission: () => true,
}));

jest.mock('../src/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    language: 'en',
  }),
}));

jest.mock('../src/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog-container">{children}</div> : null,
}));

describe('AnimalDetailsModal', () => {
  const mockAnimal = {
    animal_id: 'animal-1',
    animal_code: 'PIG-0100',
    rfid_tag: 'DEMO-POR100-SOW-01',
    animal_type: 'SOW',
    gender: 'F',
    breed_name: 'TN-70-Sow',
    status: 'ACTIVE',
    dob: '2025-01-01',
    entry_date: '2025-01-15',
    acquisition_cost: '450.00',
    book_value: '400.00',
    current_stage_code: 'LACTATION',
    current_batch_no: 'BATCH-000001',
  };

  const mockBreeding = {
    matings: [
      {
        breeding_id: 'b-1',
        mating_date: '2025-02-01',
        mating_type: 'ARTIFICIAL_INSEMINATION',
        boar_code: 'BOAR-001',
        batch_no: 'BATCH-000001',
        conception_result: 'PREGNANT',
        expected_farrowing_date: '2025-05-25',
      },
    ],
    farrowings: [
      {
        farrow_id: 'f-1',
        farrowing_date: '2025-05-24',
        piglets_born_live: 12,
        piglets_stillborn: 1,
        piglets_weaned: 11,
        avg_weaning_weight_kg: '6.5',
        farrowing_status: 'COMPLETED',
        parity_number: 1,
      },
    ],
    movements: [
      {
        movement_id: 'm-1',
        action: 'TRANSITION_STAGE',
        occurred_at: '2025-05-20',
        new_values: {
          current_stage_id: 'stage-gest',
          transition_date: '2025-05-20',
          reason: 'FARROWING_PREP',
        },
        old_values: {
          current_stage_id: 'stage-insem',
        },
      },
    ],
    transfers: [],
    lineage: {
      sire_code: 'BOAR-SIRE-99',
      dam_code: 'SOW-DAM-88',
      offspring: [
        {
          animal_id: 'piglet-1',
          animal_code: 'PIG-0201',
          gender: 'M',
          dob: '2025-05-24',
          status: 'ACTIVE',
        },
      ],
    },
    traceability_labels: {
      stages: {
        'stage-insem': 'INSEMINATION',
        'stage-gest': 'FARROWING_HOUSE',
      },
      batches: {},
      locations: {},
    },
    current_labels: {
      breed: 'TN-70-Sow',
      stage: 'LACTATION',
      batch: 'BATCH-000001',
      location: 'Sow House Pen 2',
    },
  };

  const mockMedications = [
    {
      log_id: 'med-1',
      item_name: 'Iron Injection 200mg',
      administered_date: '2025-01-20',
      dose_qty: '2',
      uom: 'ml',
      withdrawal_days: 0,
      administered_by: 'Vet Nurse',
      notes: 'Post-arrival preventative booster',
    },
  ];

  const mockLedger = [
    {
      ledger_id: 'led-1',
      posting_date: '2025-01-15',
      entry_type: 'ACQUISITION',
      unit_cost: '450.00',
      quantity: 1,
      computed_cost: '450.00',
      posting_reference: 'GRN-2025-001',
    },
    // What the API actually returns: the bio_asset_ledger row's own column names. The card read other names for these
    // three and showed a dash for every capitalised feed cost.
    {
      entry_id: 'led-2',
      posting_date: '2025-01-16',
      entry_type: 'CONSUMPTION',
      cost_amount_each_unit: '28.0000',
      quantity: '2.5500',
      cost_amount: '71.4000',
      document_no: 'BATCH-000001',
    },
  ];

  // What GET /animal/:id/activity returns: weights recorded in daily data, not a field on the register row.
  const mockActivity = {
    weights: [{ date: '2026-10-01', value: 24 }, { date: '2026-10-08', value: 185.5 }],
    condition_scores: [{ date: '2026-10-08', value: 3.5 }],
    current_weight_kg: 185.5,
    current_weight_date: '2026-10-08',
    first_weight_kg: 24,
    first_weight_date: '2026-10-01',
    adg_g_per_day: 23071,
    latest_condition_score: 3.5,
    consumption: {
      by_item: [{ item_id: 'i-1', item_code: 'FD-1', item_name: 'Lactation Meal', item_type: 'FEED', uom: 'KG', quantity: 25, cost: 31.25, last_date: '2026-10-08' }],
      recent: [],
    },
    mortality: null,
    semen_lots: [],
  };

  // The movement log: the one source of the animal's moves, a batch's own cascade and a death included.
  const mockMovementLog = [
    { movement_id: 'm-1', movement_type: 'ASSIGN', event_date: '2026-10-07', from_stage_code: null, to_stage_code: 'FARROWING', to_batch_no: 'BATCH-000001', last_date: null, reason: null },
    { movement_id: 'm-2', movement_type: 'STAGE_CHANGE', event_date: '2026-10-09', from_stage_code: 'FARROWING', to_stage_code: 'LACTATION', to_batch_no: 'BATCH-000001', last_date: '2026-10-07', reason: 'Litter weaned' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/animal/animal-1/activity') return Promise.resolve(mockActivity);
      if (url === '/animal/animal-1/movement-log') return Promise.resolve(mockMovementLog);
      if (url === '/animal/animal-1') return Promise.resolve(mockAnimal);
      if (url === '/animal/animal-1/breeding') return Promise.resolve(mockBreeding);
      if (url === '/animal/animal-1/medications') return Promise.resolve(mockMedications);
      if (url === '/animal/animal-1/bio-asset-ledger') return Promise.resolve(mockLedger);
      return Promise.resolve([]);
    });
  });

  it('renders all 7 tabs and default overview details when open', async () => {
    render(<AnimalDetailsModal animalId="animal-1" onClose={jest.fn()} />);

    // Check all 7 tabs are in the document
    expect(screen.getByText('Overview / Profile')).toBeTruthy();
    expect(screen.getByText('Lineage / Pedigree')).toBeTruthy();
    expect(screen.getByText('Health & Treatments')).toBeTruthy();
    expect(screen.getByText('Weight History')).toBeTruthy();
    expect(screen.getByText('Breeding & Lifecycle')).toBeTruthy();
    expect(screen.getByText('Movement / Transfers')).toBeTruthy();
    expect(screen.getByText('Costing & Valuation')).toBeTruthy();

    // Check animal details in overview
    await waitFor(() => {
      expect(screen.getAllByText('DEMO-POR100-SOW-01').length).toBeGreaterThan(0);
      expect(screen.getByText('185.5 kg')).toBeTruthy();
      expect(screen.getByText('$400.00')).toBeTruthy();
    });
  });

  it('shows weights and daily gain from what was recorded, and invents no birth weight or target', async () => {
    render(<AnimalDetailsModal animalId="animal-1" onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getAllByText('DEMO-POR100-SOW-01').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText('Weight History'));

    await waitFor(() => {
      expect(screen.getByText('23071 g/d')).toBeTruthy();
      expect(screen.getByText('Between 2026-10-01 and 2026-10-08')).toBeTruthy();
      expect(screen.getByText('24.0 kg')).toBeTruthy();
      expect(screen.getByText('3.5', { selector: 'span' })).toBeTruthy();
    });
    expect(screen.queryByText(/Within Expected Curve/)).toBeNull();
    expect(screen.queryByText(/~1.40 kg/)).toBeNull();
    expect(screen.queryByText(/180–240 kg/)).toBeNull();
  });

  it('builds the Movement tab from the movement log', async () => {
    render(<AnimalDetailsModal animalId="animal-1" onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getAllByText('DEMO-POR100-SOW-01').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText('Movement / Transfers'));

    await waitFor(() => {
      expect(screen.getByText('Assigned to batch')).toBeTruthy();
      expect(screen.getByText('Stage change: LACTATION')).toBeTruthy();
      expect(screen.getByText(/FARROWING → LACTATION · Litter weaned/)).toBeTruthy();
    });
  });

  it('shows what the animal consumed on the Health tab', async () => {
    render(<AnimalDetailsModal animalId="animal-1" onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getAllByText('DEMO-POR100-SOW-01').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText('Health & Treatments'));

    await waitFor(() => {
      expect(screen.getByText('Feed & Medicine Consumed')).toBeTruthy();
      expect(screen.getByText('Lactation Meal')).toBeTruthy();
    });
  });

  it('switches to Lineage tab and displays sire, dam, and offspring', async () => {
    render(<AnimalDetailsModal animalId="animal-1" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByText('DEMO-POR100-SOW-01').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText('Lineage / Pedigree'));

    await waitFor(() => {
      expect(screen.getByText('BOAR-SIRE-99')).toBeTruthy();
      expect(screen.getByText('SOW-DAM-88')).toBeTruthy();
      expect(screen.getByText('PIG-0201')).toBeTruthy();
    });
  });

  it('switches to Health & Treatments tab and displays medications', async () => {
    render(<AnimalDetailsModal animalId="animal-1" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByText('DEMO-POR100-SOW-01').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText('Health & Treatments'));

    await waitFor(() => {
      expect(screen.getByText('Iron Injection 200mg')).toBeTruthy();
      expect(screen.getByText('Post-arrival preventative booster')).toBeTruthy();
    });
  });

  it('switches to Breeding & Lifecycle tab and displays sow KPIs and farrowings', async () => {
    render(<AnimalDetailsModal animalId="animal-1" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByText('DEMO-POR100-SOW-01').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText('Breeding & Lifecycle'));

    await waitFor(() => {
      expect(screen.getByText('Services & Matings')).toBeTruthy();
      expect(screen.getByText('BOAR-001')).toBeTruthy();
      expect(screen.getByText('PREGNANT')).toBeTruthy();
      expect(screen.getByText('Farrowings & Weanings')).toBeTruthy();
    });
  });

  it('switches to Costing & Valuation tab and displays ledger postings', async () => {
    render(<AnimalDetailsModal animalId="animal-1" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getAllByText('DEMO-POR100-SOW-01').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText('Costing & Valuation'));

    await waitFor(() => {
      expect(screen.getByText('GRN-2025-001')).toBeTruthy();
      expect(screen.getByText('ACQUISITION')).toBeTruthy();
    });
  });

  it('shows the residual in force and where it comes from, and the latest month\'s charge', async () => {
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/animal/animal-1') return Promise.resolve({ ...mockAnimal, residual_effective: 307.5, residual_source: 'COMPANY', amortisation_monthly: '19.8603', latest_amortisation_date: '2026-03-31' });
      if (url === '/animal/animal-1/bio-asset-ledger') return Promise.resolve(mockLedger);
      return Promise.resolve([]);
    });
    render(<AnimalDetailsModal animalId="animal-1" onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getAllByText('DEMO-POR100-SOW-01').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('Costing & Valuation'));
    expect(await screen.findByText(/307\.50/)).toBeTruthy();
    expect(screen.getByText('Company setting')).toBeTruthy();
    expect(screen.getByText(/Latest charge, /)).toBeTruthy();
  });

  it('gives an animal her own residual only with a reason, and sends both', async () => {
    (api.get as jest.Mock).mockImplementation((url: string) => {
      if (url === '/animal/animal-1') return Promise.resolve({ ...mockAnimal, residual_effective: 307.5, residual_source: 'COMPANY' });
      if (url === '/animal/animal-1/bio-asset-ledger') return Promise.resolve(mockLedger);
      return Promise.resolve([]);
    });
    (api.put as jest.Mock).mockResolvedValue({ data: { residual: 250, source: 'ANIMAL' } });
    render(<AnimalDetailsModal animalId="animal-1" onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getAllByText('DEMO-POR100-SOW-01').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('Costing & Valuation'));
    fireEvent.click(await screen.findByText('Override for this animal'));
    fireEvent.change(screen.getByLabelText('Her residual'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toBeTruthy(); // no reason yet: nothing sent
    expect(api.put).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Heavier line, weighed at arrival' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/bio-costing/animals/animal-1/residual', { residual_value: 250, reason: 'Heavier line, weighed at arrival' }));
  });

  it('shows the cost of a ledger row under the API\'s own column names (unit cost, amount, document)', async () => {
    render(<AnimalDetailsModal animalId="animal-1" onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getAllByText('DEMO-POR100-SOW-01').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('Costing & Valuation'));
    await waitFor(() => {
      expect(screen.getAllByText('BATCH-000001').length).toBeGreaterThan(0);
      expect(screen.getAllByText(/71\.40/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/28\.00/).length).toBeGreaterThan(0);
    });
  });
});
