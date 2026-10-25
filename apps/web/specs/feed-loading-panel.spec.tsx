/**
 * W5 (10 Oct): the Loading Instruction Sheet (Requisition and Loading Sheet
 * §3, rows 60–77) shows Delivery Date, Diet No., Loaded By and Loading Date
 * Time, says its status in words, links every record it names, and opens a
 * sheet named by ?id=.
 */
import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  FeedLoadingPanel,
  loadingSheetHref,
} from '../src/components/console/inventory/feed-loading-panel';
import { api } from '../src/services/api-client';

jest.mock('../src/services/api-client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));
jest.mock('../src/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars?.no != null ? `${key}:${vars.no}` : key,
  }),
}));
jest.mock('../src/components/ui/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn() },
}));

const sheet = {
  loading_sheet_id: 'ls-1',
  loading_sheet_no: 'LOAD-REQ-MUL100-2026-00001-10000',
  consolidation_id: 'cons-1',
  requisition_id: 'req-1',
  requisition_no: 'REQ-MUL100-2026-00001',
  farm_id: 'farm-1',
  farm_code: 'MUL100',
  farm_name: 'Mulberry',
  destination_silo_id: 'silo-1',
  destination_silo_code: 'MUL100/SILO-01',
  destination_silo_name: 'Silo 1',
  item_id: 'item-8',
  item_code: 'ICAT-004-ITM-0008',
  item_name: 'Weaner Grower Mash',
  diet_no: 8,
  mill_loading_bin_id: 'bin-1',
  mill_loading_bin_code: 'MILL-001/BIN-001',
  mill_loading_bin_name: 'Bin 1',
  requested_qty_kg: '6050',
  mill_approved_qty_kg: '6000',
  scheduled_qty_kg: '6000',
  adjustment_reason: null,
  requested_delivery_date: '2026-10-12',
  compartment_no: 'C1',
  kg_loaded: '6000',
  loaded_by_name: 'Mill Loader 01',
  loaded_at: '2026-10-11 09:30:00',
  status: 'LOADED',
  shipment_no: 'TS-0001',
  transfer_id: 'tr-1',
  transfer_no: 'TO-0001',
  truck_no: 'TRK-01',
};
const withCompartments = {
  ...sheet,
  compartments: [
    {
      compartment_id: 'cp-1',
      line_no: 10000,
      compartment_no: 'C1',
      kg_loaded: '3000',
      loaded_by: 'Loader One',
      loaded_by_name: 'Loader One',
      loaded_at: '2026-10-11 09:00:00',
    },
    {
      compartment_id: 'cp-2',
      line_no: 20000,
      compartment_no: 'C2',
      kg_loaded: '3000',
      loaded_by: 'Loader Two',
      loaded_by_name: 'Loader Two',
      loaded_at: '2026-10-11 09:15:00',
    },
  ],
};
const notified = {
  ...sheet,
  status: 'DISPATCHED',
  dispatch_notification_status: 'SENT',
  dispatch_notification_message: 'Loading sheet X has left the mill',
  dispatch_notification_at: '2026-10-11 10:00:00',
};
const other = {
  ...sheet,
  loading_sheet_id: 'ls-2',
  loading_sheet_no: 'LOAD-REQ-GRS-2026-00001-10000',
  status: 'DRAFT',
  loaded_by_name: null,
  loaded_at: null,
};

const hrefOf = (name: string) =>
  screen.getByRole('link', { name }).getAttribute('href');

describe('FeedLoadingPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.history.replaceState(
      {},
      '',
      '/inventory/feed-forecast?tab=loading-instructions',
    );
    (api.get as jest.Mock).mockResolvedValue({ data: [sheet, other] });
    (api.put as jest.Mock).mockResolvedValue({ data: sheet });
  });

  it('W5B (Req r75, r76): shows the dispatch notification as Sent with its content, or Not sent', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        notified,
        {
          ...other,
          dispatch_notification_status: 'NOT_SENT',
          dispatch_notification_message: null,
        },
      ],
    });
    render(<FeedLoadingPanel />);
    const sentRow = (await screen.findByText(sheet.loading_sheet_no)).closest(
      'tr',
    )!;
    expect(screen.getByText('flsColNotification')).toBeTruthy();
    expect(within(sentRow).getByText('flsNotificationSent')).toBeTruthy();
    expect(
      within(sentRow).getByText('Loading sheet X has left the mill'),
    ).toBeTruthy();
    const notSentRow = screen.getByText(other.loading_sheet_no).closest('tr')!;
    expect(within(notSentRow).getByText('flsNotificationNotSent')).toBeTruthy();
  });

  it('Row 76: dispatch sends the typed estimated arrival, and the list shows the stored value', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: notified });
    (api.get as jest.Mock).mockResolvedValue({
      data: [
        sheet,
        {
          ...notified,
          loading_sheet_id: 'ls-3',
          loading_sheet_no: 'LOAD-DONE',
          estimated_arrival_at: '2026-10-12 14:30:00',
        },
      ],
    });
    render(<FeedLoadingPanel />);
    expect(await screen.findByText('flsColEta')).toBeTruthy();
    expect(
      within(screen.getByText('LOAD-DONE').closest('tr')!).getByText(
        '12/10/26 14:30',
      ),
    ).toBeTruthy();
    fireEvent.change(
      screen.getByLabelText(`flsEtaFor:${sheet.loading_sheet_no}`),
      { target: { value: '2026-10-12T16:45' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'flsDispatch' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/feed-requisition/loading-sheets/ls-1/dispatch',
        { estimatedArrivalAt: '2026-10-12T16:45' },
      ),
    );
  });

  it('Row 76: dispatch without an estimated arrival sends none', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: notified });
    render(<FeedLoadingPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'flsDispatch' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/feed-requisition/loading-sheets/ls-1/dispatch',
        {},
      ),
    );
  });

  it('shows Delivery Date, Diet No., Loaded By and Loading Date Time (rows 64, 65, 72, 73)', async () => {
    render(<FeedLoadingPanel />);
    const row = (await screen.findByText(sheet.loading_sheet_no)).closest(
      'tr',
    )!;
    expect(screen.getByText('flsColDeliveryDate')).toBeTruthy();
    expect(screen.getByText('flsColLoadedBy')).toBeTruthy();
    expect(screen.getByText('flsColLoadedAt')).toBeTruthy();
    expect(within(row).getByText('12/10/26')).toBeTruthy();
    expect(within(row).getByText('fcdDiet:8')).toBeTruthy();
    fireEvent.click(
      within(row).getByRole('button', { name: 'flsEditCompartments' }),
    );
    expect(
      (
        within(screen.getByRole('dialog')).getByLabelText(
          `flsLoadedByFor:${sheet.loading_sheet_no}`,
        ) as HTMLInputElement
      ).value,
    ).toBe('Mill Loader 01');
    expect(
      within(row).getByText(/^\d{2}\/\d{2}\/26 \d{2}:\d{2}$/),
    ).toBeTruthy();
  });

  it('shows detailed compartment lines under the loading sheet', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [withCompartments, other],
    });
    render(<FeedLoadingPanel />);
    const row = (await screen.findByText(sheet.loading_sheet_no)).closest(
      'tr',
    )!;
    expect(within(row).getByText(/C1 · 3,000 KG/)).toBeTruthy();
    expect(within(row).getByText(/C2 · 3,000 KG/)).toBeTruthy();
    fireEvent.click(
      within(row).getByRole('button', { name: 'flsEditCompartments' }),
    );
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByDisplayValue('C1')).toBeTruthy();
    expect(dialog.getByDisplayValue('C2')).toBeTruthy();
    expect(
      dialog.getAllByDisplayValue('3000') as HTMLInputElement[],
    ).toHaveLength(2);
    expect(dialog.getByDisplayValue('Loader One')).toBeTruthy();
    expect(dialog.getByDisplayValue('Loader Two')).toBeTruthy();
    expect(within(row).getByText('flsTruck: TRK-01')).toBeTruthy();
  });

  it('says the status in words from the shared loading map (row 77)', async () => {
    render(<FeedLoadingPanel />);
    const row = (await screen.findByText(sheet.loading_sheet_no)).closest(
      'tr',
    )!;
    expect(within(row).getByText('loadStatusLoaded')).toBeTruthy();
    expect(screen.queryByText('LOADED')).toBeNull();
  });

  it('links the requisition, farm, silo, item, BIN and transfer (rows 61–68)', async () => {
    render(<FeedLoadingPanel />);
    await screen.findByText(sheet.loading_sheet_no);
    const row = screen.getByText(sheet.loading_sheet_no).closest('tr')!;
    const link = (name: string) =>
      within(row).getByRole('link', { name }).getAttribute('href');
    expect(link('REQ-MUL100-2026-00001')).toBe(
      '/inventory/feed-forecast?tab=feed-requisition&id=req-1',
    );
    expect(link('MUL100')).toBe('/master-data/location?recordId=farm-1');
    expect(link('MUL100/SILO-01')).toBe(
      '/master-data/location?recordId=silo-1',
    );
    expect(link('ICAT-004-ITM-0008')).toBe('/master-data/item?recordId=item-8');
    expect(link('MILL-001/BIN-001')).toBe(
      '/master-data/location?recordId=bin-1',
    );
    expect(link('TO-0001')).toBe('/inventory/transfers?id=tr-1');
    expect(hrefOf(sheet.loading_sheet_no)).toBe(loadingSheetHref('ls-1'));
  });

  it('sends the Loaded By name with Save', async () => {
    render(<FeedLoadingPanel />);
    const row = (await screen.findByText(other.loading_sheet_no)).closest(
      'tr',
    )!;
    fireEvent.click(
      within(row).getByRole('button', { name: 'flsEditCompartments' }),
    );
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'flsAddCompartment' }));
    fireEvent.change(
      dialog.getByLabelText(`flsLoadedByFor:${other.loading_sheet_no}`),
      { target: { value: 'Mill Loader 02' } },
    );
    fireEvent.change(
      dialog.getByLabelText(`flsCompartmentFor:${other.loading_sheet_no}`),
      { target: { value: 'C1' } },
    );
    fireEvent.change(
      dialog.getByLabelText(`flsLoadedFor:${other.loading_sheet_no}`),
      { target: { value: '6000' } },
    );
    fireEvent.click(dialog.getByRole('button', { name: 'flsSave' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/feed-requisition/loading-sheets/ls-2',
        expect.objectContaining({ loadedBy: 'Mill Loader 02' }),
      ),
    );
  });

  it('opens the sheet named by ?id=', async () => {
    window.history.replaceState(
      {},
      '',
      '/inventory/feed-forecast?tab=loading-instructions&id=ls-2',
    );
    render(<FeedLoadingPanel />);
    const row = (await screen.findByText(other.loading_sheet_no)).closest(
      'tr',
    )!;
    await waitFor(() => expect(row.getAttribute('aria-selected')).toBe('true'));
    expect(
      screen
        .getByText(sheet.loading_sheet_no)
        .closest('tr')!
        .getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('ignores an ?id= meant for another tab', async () => {
    window.history.replaceState(
      {},
      '',
      '/inventory/feed-forecast?tab=mill-consolidation&id=ls-2',
    );
    render(<FeedLoadingPanel />);
    const row = (await screen.findByText(other.loading_sheet_no)).closest(
      'tr',
    )!;
    expect(row.getAttribute('aria-selected')).toBe('false');
  });

  it('deep links into the Loading Instructions tab', () => {
    expect(loadingSheetHref('ls 1')).toBe(
      '/inventory/feed-forecast?tab=loading-instructions&id=ls%201',
    );
  });
});
