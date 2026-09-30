import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MasterRecordView } from '../src/modules/master-data/MasterRecordView';
import { MASTER_DATA_CONFIGS } from '../src/modules/master-data/configs';
import { api } from '../src/services/api-client';

/**
 * Checklist item 1a (28 Sep check): a silo's record shows the sheds it feeds;
 * a shed's record showed nothing about its silos, so answering "where does this
 * shed get its feed?" meant opening every silo on the farm in turn. Read-only —
 * the link is still edited from the silo's Attached Sheds picker.
 */
jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn() } }));
jest.mock('../src/components/ui/toast', () => ({ showToast: { error: jest.fn() }, Toast: () => null }));
jest.mock('../src/hooks/useAuth', () => ({ getActiveWorkspaceScope: () => 'COMPANY' }));

const get = api.get as jest.Mock;
const locationConfig = MASTER_DATA_CONFIGS.find((config) => config.key === 'location')!;

const SHED = {
  location_id: 'shed-1',
  location_code: 'GRA100/SHED-001',
  location_name: 'Grower House 1',
  location_type: 'SHED',
  is_active: true,
  attached_silos: [
    { location_id: 'silo-1', location_code: 'GRA100/SILO-001', location_name: 'Feed Silo 1', current_feed_item_code: 'ICAT-004-ITM-0004', current_feed_item_name: 'Weaner Grower Mash (18% CP)' },
    { location_id: 'silo-3', location_code: 'GRA100/SILO-003', location_name: 'Feed Silo 3', current_feed_item_code: null, current_feed_item_name: null },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue({ data: SHED });
});

describe('A shed record shows the silos that feed it (checklist 1a)', () => {
  it('lists each silo as CODE — Name with the feed it holds', async () => {
    render(<MasterRecordView config={locationConfig} id="shed-1" onClose={jest.fn()} />);
    const section = await screen.findByRole('region', { name: /silos feeding this shed/i });
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('GRA100/SILO-001 — Feed Silo 1');
    expect(items[0].textContent).toContain('Weaner Grower Mash (18% CP)');
    expect(items[1].textContent).toContain('GRA100/SILO-003 — Feed Silo 3');
  });

  it('says a silo is empty rather than leaving the feed blank', async () => {
    render(<MasterRecordView config={locationConfig} id="shed-1" onClose={jest.fn()} />);
    const section = await screen.findByRole('region', { name: /silos feeding this shed/i });
    expect(within(section).getAllByRole('listitem')[1].textContent).toMatch(/empty/i);
  });

  it('says so plainly when no silo feeds the shed', async () => {
    get.mockResolvedValue({ data: { ...SHED, attached_silos: [] } });
    render(<MasterRecordView config={locationConfig} id="shed-1" onClose={jest.fn()} />);
    const section = await screen.findByRole('region', { name: /silos feeding this shed/i });
    expect(section.textContent).toMatch(/no silo/i);
    expect(within(section).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('is read-only: it offers no control to change the link', async () => {
    render(<MasterRecordView config={locationConfig} id="shed-1" onClose={jest.fn()} />);
    const section = await screen.findByRole('region', { name: /silos feeding this shed/i });
    expect(within(section).queryAllByRole('button')).toHaveLength(0);
    expect(within(section).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(section).queryAllByRole('checkbox')).toHaveLength(0);
    expect(section.textContent).toMatch(/edited on the silo/i);
  });

  it('shows nothing of the kind on a silo or a pen', async () => {
    get.mockResolvedValue({ data: { location_id: 'silo-1', location_code: 'GRA100/SILO-001', location_type: 'SILO', is_active: true, attached_sheds: ['shed-1'] } });
    const { unmount } = render(<MasterRecordView config={locationConfig} id="silo-1" onClose={jest.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: /silos feeding this shed/i })).toBeNull();
    unmount();

    get.mockResolvedValue({ data: { location_id: 'pen-1', location_code: 'GRA100/SHED-001/PEN-001', location_type: 'PEN', is_active: true } });
    render(<MasterRecordView config={locationConfig} id="pen-1" onClose={jest.fn()} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region', { name: /silos feeding this shed/i })).toBeNull();
  });
});
