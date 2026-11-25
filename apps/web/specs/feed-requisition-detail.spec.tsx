import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { Dialog } from '../src/components/ui/dialog';
import { FeedRequisitionDetail } from '../src/components/console/inventory/feed-requisition-detail';
import type { RequisitionView } from '../src/components/console/inventory/feed-requisition-document';
import { api } from '../src/services/api-client';
jest.mock('../src/components/ui/toast', () => ({
  showToast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
  Toast: () => null,
}));
import { showToast } from '../src/components/ui/toast';
beforeEach(() => {
  for (const fn of Object.values(showToast)) (fn as jest.Mock).mockClear();
});

// The embedded Transfer Order dialog is its own large screen; here it stands in as a stub that shows what the
// requisition hands it and lets a test play a post or a close.
const embeddedProps: Array<Record<string, any>> = [];
let embeddedResult: unknown = null;
jest.mock('../src/components/console/inventory/stock-transfer-panel', () => ({
  __esModule: true,
  default: (props: Record<string, any>) => {
    embeddedProps.push(props);
    return (
      <div data-testid="embedded-to" data-transfer={props.embeddedTransferId}>
        <button
          type="button"
          onClick={() => props.onEmbeddedPosted?.(embeddedResult, 'RECEIPT')}
        >
          stub-posted
        </button>
        <button type="button" onClick={() => props.onEmbeddedClose?.()}>
          stub-close
        </button>
      </div>
    );
  },
}));

jest.mock('../src/services/api-client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key;
  return { useLanguage: () => ({ t: stableT }) };
});
const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;

const action = (enabled: boolean, reason: string | null = null) => ({
  enabled,
  reason,
});
const base = (over: Partial<RequisitionView> = {}): RequisitionView => ({
  requisition_id: 'req-1',
  req_no: 'REQ-GRA100-2026-00007',
  requisition_type: 'FEED_FORECAST',
  source: 'AUTO_FORECAST',
  purpose: 'INTERNAL_TRANSFER',
  supply_source: 'MILL',
  status: 'APPROVED',
  priority: 'INFO',
  approval_request_id: 'approval-1',
  submission_deadline: '2026-10-10',
  remarks: null,
  approved_at: '2026-10-08 06:04:00',
  approval_status: 'APPROVED',
  document_status: 'OPEN',
  fulfilment_status: 'NOT_APPLICABLE',
  actions: {
    release: action(true),
    shipment: action(
      false,
      'Release the requisition before Transfer Shipment.',
    ),
    receipt: action(false, 'Release the requisition before Transfer Receipt.'),
  },
  transfers: [],
  header: {
    farm_code: 'GRA100',
    farm_name: 'GRASMERE FARM',
    requisition_date: '2026-10-04',
    is_next_diet_requisition: false,
    farm_total_requested_kg: 9000,
    truck_target_kg: 30000,
    bulk_multiple_kg: 3000,
    trips: 1,
    required_delivery_date: '2026-10-28',
    approved_by_name: 'Tenant Administrator',
    linked_transfer_no: null,
    forecast_run_no: null,
  },
  lines: [],
  ...over,
});

const transfer = (over: Record<string, unknown> = {}) => ({
  transfer_id: 'tr-1',
  transfer_no: 'TR-00001',
  status: 'DRAFT',
  posting_date: '2026-10-08',
  from_warehouse_id: 'bin-1',
  to_warehouse_id: 'silo-1',
  bin_assignment_id: 'assignment-1',
  lines: [
    {
      transfer_line_id: 'tl-1',
      requisition_line_id: 'rl-1',
      item_id: 'feed-1',
      item_code: 'FEED-1',
      item_name: 'Grower Feed',
      quantity: 1000,
      uom: 'KG',
      qty_shipped: 0,
      qty_received: 0,
      balance_to_ship: 1000,
      remaining_to_receive: 0,
    },
  ],
  open_shipments: [],
  ...over,
});

const draftView: RequisitionView = base({
  status: 'AUTO_DRAFT',
  approval_request_id: null,
  farm_id: 'farm-vil',
  actions: undefined,
  lines: [
    {
      line_id: 'L1',
      line_seq: 10000,
      destination_location_id: 'silo-1',
      destination_code: 'VIL100/SILO-001',
      item_id: 'r1',
      item_code: 'FEED-R1',
      item_description: 'Weaner Diet R1',
      required_item_id: 'r1',
      feed_type: 'BULK',
      is_next_diet: false,
      days_before_diet_change: null,
      lifecycle_ref_label: 'WEANER days 21–24',
      system_balance_kg: '1500.0000',
      daily_requirement_kg: '2000.0000',
      days_remaining: 0,
      first_shortage_date: '2099-09-23',
      unrounded_need_kg: '4500.0000',
      recommended_qty_kg: '6000.0000',
      quantity: '6000.0000',
      bag_count: null,
      proposed_delivery_date: '2099-09-23',
      exceeds_silo_capacity: false,
      exception_reason: null,
      breakdown: [],
    },
  ],
});

function renderDetail(view: RequisitionView, onView = jest.fn()) {
  render(
    <Dialog open onClose={jest.fn()} title={view.req_no} presentation="page">
      <FeedRequisitionDetail
        view={view}
        onView={onView}
        onBack={jest.fn()}
        embedded
      />
    </Dialog>,
  );
  return onView;
}

beforeEach(() => {
  jest.clearAllMocks();
  embeddedProps.length = 0;
  embeddedResult = null;
  get.mockResolvedValue({ data: { destinations: [], items: [] } });
  post.mockResolvedValue({ data: base() });
  put.mockResolvedValue({ data: draftView });
});

describe('FeedRequisitionDetail draft document', () => {
  it("fetches the farm's options from view.farm_id", async () => {
    render(
      <FeedRequisitionDetail
        view={draftView}
        onView={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        '/feed-requisition/options?farmId=farm-vil',
      ),
    );
  });

  it('edits a line quantity and Save calls PUT and then onView with the response', async () => {
    const onView = jest.fn();
    render(
      <FeedRequisitionDetail
        view={draftView}
        onView={onView}
        onBack={jest.fn()}
      />,
    );
    fireEvent.change(
      await screen.findByLabelText('rqdRequestedFor:{"line":10000}'),
      { target: { value: '6100' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'rqSave' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/feed-requisition/req-1', {
        remarks: '',
        lines: [{ line_id: 'L1', quantity_kg: 6100 }],
      }),
    );
    expect(onView).toHaveBeenCalledWith(draftView);
    expect(showToast.success).toHaveBeenCalledWith('rqSaved');
  });

  it('shows Priority No. on each line and no priority level, even one stored on an older line (Rishi, 2 Nov)', async () => {
    render(
      <FeedRequisitionDetail
        view={{
          ...draftView,
          lines: draftView.lines.map((l: any, i: number) =>
            i === 0 ? { ...l, priority: 'WARNING', priority_no: 3 } : l,
          ),
        }}
        onView={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.getAllByText('rqdColPriorityNo').length).toBeGreaterThan(0);
    expect(screen.queryByText('rqdColPriority')).toBeNull();
    expect(screen.queryByText('prioWarning')).toBeNull();
    expect(screen.queryByRole('button', { name: /rqdPriorityFor/ })).toBeNull();
  });

  it('renders no Save or Submit buttons once approved', () => {
    render(
      <FeedRequisitionDetail
        view={base()}
        onView={jest.fn()}
        onBack={jest.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'rqSave' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'rqSubmit' })).toBeNull();
  });

  it('calls onBack when the back button is clicked', () => {
    const onBack = jest.fn();
    render(
      <FeedRequisitionDetail
        view={draftView}
        onView={jest.fn()}
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'rqBack' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('suppresses its own Back and title strip when embedded', () => {
    render(
      <FeedRequisitionDetail
        view={draftView}
        onView={jest.fn()}
        onBack={jest.fn()}
        embedded
      />,
    );
    expect(screen.getByRole('button', { name: 'rqSave' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'rqBack' })).toBeNull();
    expect(screen.queryByText(draftView.req_no, { selector: 'h2' })).toBeNull();
  });
});

describe('FeedRequisitionDetail workflow actions', () => {
  it('always renders Release, Transfer Shipment and Transfer Receipt in the dialog header from server action state', () => {
    renderDetail(base());
    const header = screen
      .getByRole('dialog')
      .querySelector('header') as HTMLElement;
    expect(
      (
        within(header).getByRole('button', {
          name: 'crqRelease',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      (
        within(header).getByRole('button', {
          name: 'crqShip',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        within(header).getByRole('button', {
          name: 'crqReceive',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      within(header)
        .getByRole('button', { name: 'crqShip' })
        .getAttribute('title'),
    ).toBe('Release the requisition before Transfer Shipment.');
  });

  it('releases an approved requisition and refreshes the parent view', async () => {
    const released = base({ document_status: 'RELEASED' });
    post.mockResolvedValue({ data: released });
    const onView = renderDetail(base());

    fireEvent.click(screen.getByRole('button', { name: 'crqRelease' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/feed-requisition/req-1/release', {}),
    );
    expect(onView).toHaveBeenCalledWith(released);
    expect(showToast.success).toHaveBeenCalledWith('rqReleased');
  });

  // Rishi, 12 Nov: the requisition holds the shared Transfer Order dialog; Ship and Receive open it instead of a
  // posting form of their own. The feed receipt checks live in that dialog (feed-receipt-checks.spec.ts).
  describe('the embedded Transfer Order dialog', () => {
    const bagged = [
      {
        line_id: 'rl-1',
        line_seq: 1,
        feed_type: 'BAGGED',
        item_id: 'feed-1',
        item_code: 'FEED-1',
        quantity: '1000.0000',
        destination_location_id: 'silo-1',
        destination_code: 'S1',
        required_item_id: 'feed-1',
        is_next_diet: false,
        days_before_diet_change: null,
        lifecycle_ref_label: null,
        system_balance_kg: null,
        daily_requirement_kg: null,
        days_remaining: null,
        first_shortage_date: null,
        unrounded_need_kg: null,
        recommended_qty_kg: null,
        bag_count: null,
        proposed_delivery_date: null,
        exceeds_silo_capacity: false,
        exception_reason: null,
        breakdown: [],
      },
      {
        line_id: 'rl-2',
        line_seq: 2,
        feed_type: 'BULK',
        item_id: 'feed-2',
        item_code: 'FEED-2',
        quantity: '600.0000',
        destination_location_id: 'silo-1',
        destination_code: 'S1',
        required_item_id: 'feed-2',
        is_next_diet: false,
        days_before_diet_change: null,
        lifecycle_ref_label: null,
        system_balance_kg: null,
        daily_requirement_kg: null,
        days_remaining: null,
        first_shortage_date: null,
        unrounded_need_kg: null,
        recommended_qty_kg: null,
        bag_count: null,
        proposed_delivery_date: null,
        exceeds_silo_capacity: false,
        exception_reason: null,
        breakdown: [],
      },
    ] as unknown as RequisitionView['lines'];
    const shipped = transfer({
      transfer_id: 'tr-2',
      transfer_no: 'TR-00002',
      open_shipments: [{ shipment_id: 'sh-9', shipment_no: 'SH-9', lines: [] }],
    });
    const view = (over: Partial<RequisitionView> = {}) =>
      base({
        document_status: 'RELEASED',
        actions: {
          release: action(false),
          shipment: action(true),
          receipt: action(true),
        },
        transfers: [shipped],
        lines: bagged,
        header: {
          ...base().header,
          bag_size_kg: 25,
        } as RequisitionView['header'],
        ...over,
      });

    it('Transfer Shipment opens the dialog on the transfer that still has a balance to ship, not a form of its own', () => {
      const done = transfer({
        transfer_id: 'tr-0',
        transfer_no: 'TR-00000',
        lines: [{ ...transfer().lines[0], balance_to_ship: 0 }],
      });
      renderDetail(view({ transfers: [done, transfer()] }));
      expect(screen.queryByTestId('embedded-to')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'crqShip' }));
      expect(
        screen.getByTestId('embedded-to').getAttribute('data-transfer'),
      ).toBe('tr-1');
      expect(screen.queryByLabelText('rqTransfer')).toBeNull();
      expect(embeddedProps.at(-1)).toMatchObject({
        embeddedRequisition: { id: 'req-1', kind: 'FEED' },
      });
    });

    it('Transfer Receipt opens the transfer with an open shipment, naming it, with the feed checks the receipt needs', () => {
      renderDetail(view({ transfers: [transfer(), shipped] }));
      fireEvent.click(screen.getByRole('button', { name: 'crqReceive' }));
      expect(
        screen.getByTestId('embedded-to').getAttribute('data-transfer'),
      ).toBe('tr-2');
      expect(embeddedProps.at(-1)).toMatchObject({
        embeddedShipmentId: 'sh-9',
        // Only the BAGGED line asks for a bag count, against the farm's bag size.
        embeddedFeed: { bagSizeKg: 25, baggedRequisitionLineIds: ['rl-1'] },
      });
    });

    it('falls back to a 50 kg bag when the farm states none', () => {
      renderDetail(
        view({
          transfers: [shipped],
          header: { ...base().header } as RequisitionView['header'],
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'crqReceive' }));
      expect(embeddedProps.at(-1)?.embeddedFeed.bagSizeKg).toBe(50);
    });

    it('opens the same dialog from a linked transfer number in the document', () => {
      renderDetail(
        view({
          transfers: [shipped],
          header: {
            ...base().header,
            linked_transfers: [
              { transfer_id: 'tr-2', transfer_no: 'TR-00002' },
            ],
          } as RequisitionView['header'],
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'TR-00002' }));
      expect(
        screen.getByTestId('embedded-to').getAttribute('data-transfer'),
      ).toBe('tr-2');
    });

    it('a post in the dialog refreshes the requisition and shows the receipt it made', () => {
      const result = base({
        document_status: 'RELEASED',
      }) as RequisitionView & { receipt: unknown };
      result.receipt = {
        receipt_no: 'RCT-1',
        transfer_id: 'tr-2',
        lines: [
          {
            line_id: 'x',
            requisition_line_id: 'rl-1',
            qty_received: 1000,
            variance_qty: 0,
            silo_balance_after: 4200,
          },
        ],
      };
      const onView = renderDetail(view({ transfers: [shipped] }));
      fireEvent.click(screen.getByRole('button', { name: 'crqReceive' }));
      embeddedResult = result;
      fireEvent.click(screen.getByRole('button', { name: 'stub-posted' }));
      expect(onView).toHaveBeenCalledWith(result);
      expect(
        screen.getByRole('status', { name: 'w2tLastReceipt' }).textContent,
      ).toContain('RCT-1');
    });

    it('closing the dialog leaves the requisition as it was', () => {
      renderDetail(view({ transfers: [shipped] }));
      fireEvent.click(screen.getByRole('button', { name: 'crqReceive' }));
      fireEvent.click(screen.getByRole('button', { name: 'stub-close' }));
      expect(screen.queryByTestId('embedded-to')).toBeNull();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  });

  describe('the workflow notice (Rishi, 11 Oct)', () => {
    const releasedView = (over: Partial<RequisitionView> = {}) =>
      base({
        document_status: 'RELEASED',
        actions: {
          release: action(false),
          shipment: action(true),
          receipt: action(true),
        },
        transfers: [transfer({ open_shipments: [] })],
        ...over,
      });

    it("shows 'Release completed' as a success alert with spacing, not an error", () => {
      renderDetail(
        releasedView({
          actions: {
            release: action(false, 'Already released.'),
            shipment: action(true),
            receipt: action(false),
          },
        }),
      );
      const notice = screen.getByTestId('feed-workflow-notice');
      expect(notice.textContent).toContain(
        'Release completed. Post the Transfer Shipment to continue.',
      );
      expect(notice.className).toContain('mb-4');
      const box = notice.firstElementChild as HTMLElement;
      expect(box.getAttribute('style')).toContain('var(--success-muted)');
      expect(box.getAttribute('style')).not.toContain('var(--danger');
    });

    it('shows a blocked step as a warning, not an error', () => {
      renderDetail(base());
      const box = screen.getByTestId('feed-workflow-notice')
        .firstElementChild as HTMLElement;
      expect(box.getAttribute('style')).toContain('var(--warning-muted)');
    });
  });
});

// Rishi, 25 Nov: sending is checked on the farm's Sunday against that day's posted count; the screen says why not.
describe('FeedRequisitionDetail sending check', () => {
  const GATE = '/feed-requisition/req-1/submit-gate';
  const PROBLEM =
    'Feed requisitions can be sent only on Sunday. It is Monday on this farm.';
  const OPTIONS = {
    destinations: [
      { location_id: 'silo-2', location_code: 'S2', location_name: 'Silo two' },
    ],
    items: [],
  };
  const answer = (gate: () => Promise<unknown>) =>
    get.mockImplementation((url: string) =>
      url === GATE ? gate() : Promise.resolve({ data: OPTIONS }),
    );
  const blocked = () =>
    answer(async () => ({
      data: { allowed: false, today: '2026-11-30', problems: [PROBLEM] },
    }));
  const submitButton = () => screen.getByRole('button', { name: 'rqSubmit' });
  const saveButton = () => screen.getByRole('button', { name: 'rqSave' });
  const gateCalls = () => get.mock.calls.filter(([url]) => url === GATE).length;
  const view = { ...draftView, remarks: 'ok' };

  it('shows why it cannot be sent, disables Submit and leaves Save', async () => {
    blocked();
    renderDetail(view);
    expect(await screen.findByText(PROBLEM)).toBeTruthy();
    expect(screen.getByText('rqSendBlocked')).toBeTruthy();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('says nothing when it may be sent', async () => {
    answer(async () => ({
      data: { allowed: true, today: '2026-11-29', problems: [] },
    }));
    renderDetail(view);
    await waitFor(() => expect(gateCalls()).toBe(1));
    await act(async () => undefined);
    expect(screen.queryByText('rqSendBlocked')).toBeNull();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('leaves the server to decide when the check cannot be loaded', async () => {
    answer(() => Promise.reject(new Error('down')));
    renderDetail(view);
    await waitFor(() => expect(gateCalls()).toBe(1));
    await act(async () => undefined);
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('enables Submit after an unsaved silo change', async () => {
    blocked();
    renderDetail(view);
    await screen.findByText(PROBLEM);
    fireEvent.click(
      await screen.findByRole('button', { name: /rqdSiloFor/ }),
    );
    fireEvent.click(await screen.findByRole('option', { name: /Silo two/ }));
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('checks again after Save, which hands back a new view', async () => {
    blocked();
    const element = (v: RequisitionView) => (
      <Dialog open onClose={jest.fn()} title={v.req_no} presentation="page">
        <FeedRequisitionDetail
          view={v}
          onView={jest.fn()}
          onBack={jest.fn()}
          embedded
        />
      </Dialog>
    );
    const { rerender } = render(element(view));
    await waitFor(() => expect(gateCalls()).toBe(1));
    rerender(element({ ...view }));
    await waitFor(() => expect(gateCalls()).toBe(2));
  });

  it('does not ask for a requisition that can no longer be changed', async () => {
    blocked();
    renderDetail(base());
    await act(async () => undefined);
    expect(gateCalls()).toBe(0);
  });
});
