import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import StageWiseConsumptionOutputPanel, {
  TAB_KEYS,
} from '../src/components/console/piggery/stage-wise-consumption-output-panel';
import { api } from '../src/services/api-client';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/batches/records',
}));

jest.mock('../src/services/api-client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    upload: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('../src/hooks/useAuth', () => ({
  getActiveCompanyId: () => 'company-123',
}));

jest.mock('../src/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock('../src/hooks/useCompanyCurrency', () => ({
  useCompanyCurrency: () => ({
    formatMoney: (val: any) => `$${Number(val || 0).toFixed(2)}`,
    currencyCode: 'USD',
  }),
}));

const mockBatch = {
  batch_id: 'batch-001',
  batch_no: 'BATCH-000001',
  remarks: 'Sow Breeding Batch',
  breed_name: 'Large White',
  opening_quantity: 25,
  closing_quantity: 25,
  start_date: '2026-08-01',
  current_stage_code: 'QUARANTINE',
};

const mockDataEntryResponse = {
  progress: [
    { stage_id: 'stg-1', stage_code: 'QUARANTINE', stage_name: 'Quarantine', animal_count: 5, stage_sequence: 1 },
    { stage_id: 'stg-2', stage_code: 'FLUSH', stage_name: 'Flush', animal_count: 10, stage_sequence: 2 },
    { stage_id: 'stg-3', stage_code: 'INSEMINATION', stage_name: 'Insemination', animal_count: 10, stage_sequence: 3 },
  ],
  stages: [],
};

describe('StageWiseConsumptionOutputPanel', () => {
  const get = api.get as jest.Mock;

  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async (path: string) => {
      if (path.startsWith('/batch?')) {
        return [mockBatch];
      }
      if (path === '/batch/batch-001') {
        return {
          ...mockBatch,
          transactions: [
            {
              transaction_id: 'tx-1',
              transaction_date: '2026-08-10',
              transaction_type: 'CONSUMPTION',
              item_name: 'Flush Feed',
              quantity: 50,
              rate: 2,
              amount: 100,
              uom: 'KG',
              remarks: 'Flush Feed — scheduled entry',
            },
            {
              transaction_id: 'tx-2',
              transaction_date: '2026-08-12',
              transaction_type: 'OVERHEAD',
              quantity: 8,
              rate: 15,
              amount: 120,
              uom: 'HRS',
              remarks: 'Daily Farm Labour',
            },
          ],
          stage_log: [],
          attachments: [
            {
              attachment_id: 'att-1',
              file_name: 'inspection-1.jpg',
              file_type: 'image/jpeg',
              file_url: 'https://example.com/inspection-1.jpg',
              log_date: '2026-08-10',
              attachment_type: 'IMAGE',
            },
          ],
        };
      }
      if (path.startsWith('/batch/batch-001/data-entry')) {
        return mockDataEntryResponse;
      }
      if (path.startsWith('/batch/batch-001/attachment')) {
        return [
          {
            attachment_id: 'att-1',
            file_name: 'inspection-1.jpg',
            file_type: 'image/jpeg',
            file_url: 'https://example.com/inspection-1.jpg',
            log_date: '2026-08-10',
            attachment_type: 'IMAGE',
          },
        ];
      }
      if (path.startsWith('/animal?')) {
        return [
          { animal_id: 'an-1', animal_code: 'PIG-001', ear_tag: 'TAG-001', current_stage_code: 'FLUSH' },
          { animal_id: 'an-2', animal_code: 'PIG-002', ear_tag: 'TAG-002', current_stage_code: 'INSEMINATION' },
        ];
      }
      if (path === '/stage') {
        return [
          { stage_id: 'stg-1', stage_code: 'QUARANTINE', stage_name: 'Quarantine', stage_sequence: 1 },
          { stage_id: 'stg-2', stage_code: 'FLUSH', stage_name: 'Flush', stage_sequence: 2 },
          { stage_id: 'stg-3', stage_code: 'INSEMINATION', stage_name: 'Insemination', stage_sequence: 3 },
        ];
      }
      return [];
    });
  });

  it('defines TAB_KEYS strictly matching activity line types plus PHOTO_UPLOADER', () => {
    expect(TAB_KEYS).toEqual([
      'CONSUMPTION',
      'OUTPUT',
      'DESCRIPTIVE',
      'RESOURCE',
      'OVERHEAD',
      'TRANSFER',
      'PHOTO_UPLOADER',
    ]);
  });

  it('removes Log Consumption and Recalculate buttons while retaining Export button', async () => {
    render(<StageWiseConsumptionOutputPanel />);

    // Wait for batch data to load
    await waitFor(() => {
      expect(screen.getByText(/BATCH-000001/)).toBeDefined();
    });

    // Ensure removed buttons are NOT in the document
    expect(screen.queryByText(/Log Consumption/i)).toBeNull();
    expect(screen.queryByText(/swLogConsumption/i)).toBeNull();
    expect(screen.queryByText(/Recalculate/i)).toBeNull();
    expect(screen.queryByText(/swRecalculate/i)).toBeNull();

    // Export button remains present
    expect(screen.getByRole('button', { name: /swExport/i })).toBeDefined();
  });

  it('renders all activity line type tabs and the photo uploader tab', async () => {
    render(<StageWiseConsumptionOutputPanel />);

    await waitFor(() => {
      expect(screen.getByText(/BATCH-000001/)).toBeDefined();
    });

    // Activity line tabs
    expect(screen.getByRole('button', { name: /^Consumption/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Output/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Descriptive/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Resource/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Overhead/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Transfer/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Photo Uploader/i })).toBeDefined();
  });

  it('displays stages as per data entry on the selected batch', async () => {
    render(<StageWiseConsumptionOutputPanel />);

    await waitFor(() => {
      expect(screen.getAllByText(/Quarantine/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Flush/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Insemination/i).length).toBeGreaterThan(0);
    });

    // Stages from data-entry are rendered in stage pill stepper
    expect(screen.getByRole('button', { name: /Quarantine/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Flush/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Insemination/i })).toBeDefined();
  });

  it('switches to Photo Uploader tab and displays uploader area and existing photos', async () => {
    render(<StageWiseConsumptionOutputPanel />);

    await waitFor(() => {
      expect(screen.getByText(/BATCH-000001/)).toBeDefined();
    });

    const photoTab = screen.getByRole('button', { name: /Photo Uploader/i });
    fireEvent.click(photoTab);

    // Photo uploader component is active
    expect(screen.getByText(/Upload Batch Inspection \/ Clinical Photo/i)).toBeDefined();
    expect(screen.getByText(/inspection-1.jpg/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Upload Photo/i })).toBeDefined();
  });
});
