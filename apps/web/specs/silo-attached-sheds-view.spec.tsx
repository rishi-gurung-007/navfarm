import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MasterRecordView } from '../src/modules/master-data/MasterRecordView';
import { MASTER_DATA_CONFIGS } from '../src/modules/master-data/configs';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/components/ui/toast', () => ({ showToast: { error: jest.fn() }, Toast: () => null }));
jest.mock('../src/hooks/useAuth', () => ({ getActiveWorkspaceScope: () => 'COMPANY' }));

const get = api.get as jest.Mock;
const locationConfig = MASTER_DATA_CONFIGS.find((config) => config.key === 'location')!;

describe('A silo record shows human-readable attached sheds instead of raw IDs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('displays attached sheds using pre-loaded attached_shed_details', async () => {
    const SILO = {
      location_id: 'silo-1',
      location_code: 'FARM-001/SILO-001',
      location_name: 'FARM-001 Feed Silo 1',
      location_type: 'SILO',
      parent_location_id: 'farm-1',
      is_active: true,
      attached_sheds: ['74b0010c-8237-485b-ae40-7549263b13de'],
      attached_shed_details: [
        {
          location_id: '74b0010c-8237-485b-ae40-7549263b13de',
          location_code: 'FARM-001/SHED-001',
          location_name: 'Breeding & Gestation Complex',
        },
      ],
    };

    get.mockResolvedValue({ data: SILO });

    render(<MasterRecordView config={locationConfig} id="silo-1" onClose={jest.fn()} />);

    const text = await screen.findByText('FARM-001/SHED-001 — Breeding & Gestation Complex');
    expect(text).toBeDefined();
    expect(screen.queryByText('74b0010c-8237-485b-ae40-7549263b13de')).toBeNull();
  });

  it('resolves attached sheds from endpoint when attached_shed_details is absent', async () => {
    const SILO = {
      location_id: 'silo-1',
      location_code: 'FARM-001/SILO-001',
      location_name: 'FARM-001 Feed Silo 1',
      location_type: 'SILO',
      parent_location_id: 'farm-1',
      is_active: true,
      attached_sheds: ['74b0010c-8237-485b-ae40-7549263b13de'],
    };

    get.mockImplementation((url: string) => {
      if (url === '/location/silo-1') {
        return Promise.resolve({ data: SILO });
      }
      if (url.includes('/location?shedsForSilo=farm-1')) {
        return Promise.resolve({
          data: [
            {
              location_id: '74b0010c-8237-485b-ae40-7549263b13de',
              location_code: 'FARM-001/SHED-001',
              location_name: 'Breeding & Gestation Complex',
            },
          ],
        });
      }
      if (url.includes('/location/74b0010c-8237-485b-ae40-7549263b13de')) {
        return Promise.resolve({
          data: {
            location_id: '74b0010c-8237-485b-ae40-7549263b13de',
            location_code: 'FARM-001/SHED-001',
            location_name: 'Breeding & Gestation Complex',
          },
        });
      }
      return Promise.resolve({ data: {} });
    });

    render(<MasterRecordView config={locationConfig} id="silo-1" onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('FARM-001/SHED-001 — Breeding & Gestation Complex')).toBeDefined();
    });
    expect(screen.queryByText('74b0010c-8237-485b-ae40-7549263b13de')).toBeNull();
  });

  it('displays "None attached" when attached_sheds is empty', async () => {
    const SILO = {
      location_id: 'silo-1',
      location_code: 'FARM-001/SILO-001',
      location_name: 'FARM-001 Feed Silo 1',
      location_type: 'SILO',
      parent_location_id: 'farm-1',
      is_active: true,
      attached_sheds: [],
    };

    get.mockResolvedValue({ data: SILO });

    render(<MasterRecordView config={locationConfig} id="silo-1" onClose={jest.fn()} />);

    const emptyText = await screen.findByText('None attached');
    expect(emptyText).toBeDefined();
  });
});
