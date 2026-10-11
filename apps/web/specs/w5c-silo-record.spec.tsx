import React from 'react';
import { render, screen } from '@testing-library/react';
import { MasterRecordView } from '../src/modules/master-data/MasterRecordView';
import { MASTER_DATA_CONFIGS } from '../src/modules/master-data/configs';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/components/ui/toast', () => ({ showToast: { error: jest.fn() }, Toast: () => null }));
jest.mock('../src/hooks/useAuth', () => ({ getActiveWorkspaceScope: () => 'COMPANY' }));

const locationConfig = MASTER_DATA_CONFIGS.find((config) => config.key === 'location')!;

// W5C: Master r15 (First Shortage Date), r16 (Feed in Silo links to the item), r8 (dated shed links).
describe('silo record: W5C facts', () => {
  const SILO = {
    location_id: 'silo-1', location_code: 'F1/SILO-001', location_name: 'Silo 1', location_type: 'SILO', parent_location_id: 'farm-1', is_active: true,
    silo_feed_item: 'FEED-R1 — Weaner R1', silo_feed_item_id: 'item-r1', first_shortage_date: '2026-10-18',
    attached_sheds: ['shed-1'],
    attached_shed_details: [{ location_id: 'shed-1', location_code: 'F1/SHED-001', location_name: 'Shed 1', effective_from: '2026-10-20', effective_to: null }],
  };

  it('shows the First Shortage Date, links Feed in Silo to the item record and shows the shed dates', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: SILO });
    render(<MasterRecordView config={locationConfig} id="silo-1" onClose={jest.fn()} />);

    expect(await screen.findByText('First Shortage Date')).toBeDefined();
    const link = await screen.findByRole('link', { name: 'FEED-R1' });
    expect(link.getAttribute('href')).toBe('/master-data/item?recordId=item-r1');
    expect(await screen.findByText('F1/SHED-001 — Shed 1 (2026-10-20 → …)')).toBeDefined();
  });
});
