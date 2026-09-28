import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AnimalDetailsModal from '../src/components/console/piggery/animal-details-modal';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  api: {
    get: jest.fn(),
  },
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
    ear_tag: 'DEMO-POR100-SOW-01',
    rfid_tag: 'RFID-1234',
    animal_type: 'SOW',
    gender: 'F',
    breed_name: 'TN-70-Sow',
    status: 'ACTIVE',
    dob: '2025-01-01',
    entry_date: '2025-01-15',
    current_weight_kg: '185.5',
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
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (api.get as jest.Mock).mockImplementation((url: string) => {
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
});
