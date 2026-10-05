import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import RequisitionsPanel, { needsRemarks, remarksRequiredMessage } from '../src/components/console/inventory/requisitions-panel';
import { api } from '../src/services/api-client';
import { resetForecastWindow, setForecastWindow } from '../src/components/console/inventory/feed-forecast-window';
import { addDaysIso, defaultWindowEnd, todayIso } from '../src/components/console/inventory/feed-format';
import { formatDateShort } from '../src/utils/date-short';

jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../src/hooks/useLanguage', () => {
  const stableT = (key: string, vars?: Record<string, any>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);
  return { useLanguage: () => ({ t: stableT }) };
});
let mockFarm: any;
jest.mock('../src/components/console/inventory/use-feed-farm', () => ({ useFeedFarm: () => mockFarm }));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;

const listRow = {
  requisition_id: 'req-1', req_no: 'REQ-VIL100-2026-00004', requisition_type: 'FEED_FORECAST', status: 'AUTO_DRAFT', priority: 'CRITICAL',
  required_date: '2099-09-23', submission_deadline: '2099-09-26', line_count: 2, requested_kg: '15000.0000', approval_request_id: null,
};
const view = {
  requisition_id: 'req-1', req_no: 'REQ-VIL100-2026-00004', requisition_type: 'FEED_FORECAST', source: 'AUTO_FORECAST',
  purpose: 'INTERNAL_TRANSFER', supply_source: 'MILL', status: 'AUTO_DRAFT', priority: 'CRITICAL', approval_request_id: null,
  production_date: '2099-09-27', submission_deadline: '2099-09-26', remarks: null, truck_target_kg: 30000, approved_at: null,
  // Task 9: the document header (Requisition §1).
  header: {
    farm_code: 'VIL100', farm_name: 'Villa Franca', requisition_date: '2099-09-20', is_next_diet_requisition: true,
    farm_total_requested_kg: 15000, truck_target_kg: 30000, bulk_multiple_kg: 3000, trips: 1, required_delivery_date: '2099-09-23',
    approved_by_name: null, linked_transfer_no: null, forecast_run_no: 'FFR-farm-vil-000004',
  },
  lines: [
    { line_id: 'L1', line_seq: 10000, destination_location_id: 'silo-1', destination_code: 'VIL100/SILO-001', item_id: 'r1', item_code: 'FEED-R1', item_name: 'Weaner Diet R1',
      item_description: 'Weaner Diet R1', required_item_id: 'r1', lifecycle_ref_label: 'L-LINE WEANER days 21–24', first_shortage_date: '2099-09-23',
      exceeds_silo_capacity: false, exception_reason: null, breakdown: [], feed_type: 'BULK',
      is_next_diet: false, days_before_diet_change: null, system_balance_kg: '1500.0000', daily_requirement_kg: '2000.0000', days_remaining: 0,
      unrounded_need_kg: '4500.0000', recommended_qty_kg: '6000.0000', quantity: '6000.0000', bag_count: null, proposed_delivery_date: '2099-09-23', needs_silo_changeover: false },
    { line_id: 'L2', line_seq: 20000, destination_location_id: 'silo-2', destination_code: 'VIL100/SILO-002', item_id: 'r2', item_code: 'FEED-R2', item_name: 'Weaner Diet R2',
      item_description: 'Weaner Diet R2', required_item_id: 'r2', lifecycle_ref_label: 'L-LINE WEANER days 25–27', first_shortage_date: '2099-09-26',
      exceeds_silo_capacity: false, exception_reason: null, feed_type: 'BULK',
      breakdown: [{ batch_id: 'b1', batch_no: 'B-001', shed_id: 'h3', shed_code: 'VIL100/SHED-003', heads: 1000, feed_rate_kg: 0.5,
        lifecycle_ref_label: 'L-LINE WEANER days 25–27', demand_kg: 995, first_demand_date: '2099-09-26' }],
      is_next_diet: true, days_before_diet_change: 3, system_balance_kg: '1000.0000', daily_requirement_kg: '2500.0000', days_remaining: null,
      unrounded_need_kg: '9000.0000', recommended_qty_kg: '9000.0000', quantity: '9000.0000', bag_count: null, proposed_delivery_date: '2099-09-26', needs_silo_changeover: false },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  resetForecastWindow();
  window.history.replaceState(null, '', '/inventory/requisitions');
  mockFarm = { farmId: 'farm-vil', setFarmId: jest.fn(), farms: [{ farmId: 'farm-vil', code: 'VIL100', name: 'Villa Franca', companyId: 'co', companyName: 'T' }], loaded: true, failed: false, isFixed: false, fixedFarm: null };
  get.mockImplementation(async (url: string) => (url.startsWith('/feed-requisition/') ? { data: view } : { data: [listRow] }));
  post.mockImplementation(async (url: string) =>
    url === '/feed-requisition/auto-draft' ? { data: { requisitionId: 'req-1', requisition: view } } : { data: { ...view, status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' } });
  put.mockResolvedValue({ data: view });
});

/**
 * 9d F2 (Part A verification pass 2): the red error above Submit read "Add
 * remarks: a quantity is more than 20% off the recommendation, or the deadline
 * has passed" whatever the real cause, so a farm that had only moved a
 * delivery date (Req. row 29) or set an item exception (row 13) was told the
 * wrong reason. The text is asserted against the English dictionary itself.
 */
describe('remarksRequiredMessage — the error names the real causes and their lines (9d F2)', () => {
  const dict = (jest.requireActual('../src/utils/translations') as { translations: { en: Record<string, string> } }).translations.en;
  const t = ((key: string, vars?: Record<string, string | number>) =>
    String(dict[key] ?? key).replace(/\{\{(\w+)\}\}/g, (m: string, n: string) => (vars && n in vars ? String(vars[n]) : m))
  ) as Parameters<typeof remarksRequiredMessage>[0];
  const causes = (over: Partial<{ deviating: number[]; moved: number[]; exceptioned: number[]; late: boolean }> = {}) =>
    ({ deviating: [], moved: [], exceptioned: [], late: false, ...over });

  it('names nothing when nothing requires remarks', () => {
    expect(remarksRequiredMessage(t, causes())).toBeNull();
  });

  it('names a moved delivery date and its line (Req. row 29)', () => {
    expect(remarksRequiredMessage(t, causes({ moved: [10000] })))
      .toBe("Add remarks: the delivery date on line 10000 was moved off the forecast's.");
  });

  it('names an item exception and its line (Req. row 13)', () => {
    expect(remarksRequiredMessage(t, causes({ exceptioned: [20000] })))
      .toBe('Add remarks: the feed item on line 20000 is an exception.');
  });

  it('names a quantity deviation, the passed deadline, and several lines at once', () => {
    expect(remarksRequiredMessage(t, causes({ deviating: [10000, 20000], late: true })))
      .toBe('Add remarks: a quantity on lines 10000, 20000 is more than 20% off the recommendation; the submission deadline has passed.');
  });

  it('names every cause present, in the order the hint lists them', () => {
    expect(remarksRequiredMessage(t, causes({ deviating: [10000], moved: [20000], exceptioned: [30000], late: true })))
      .toBe("Add remarks: a quantity on line 10000 is more than 20% off the recommendation; "
        + "the delivery date on line 20000 was moved off the forecast's; "
        + 'the feed item on line 30000 is an exception; the submission deadline has passed.');
  });
});

describe('needsRemarks — checkpoint 18', () => {
  it('matches the API rule', () => {
    expect(needsRemarks(6000, 9000)).toBe(true);
    expect(needsRemarks(6000, 7200)).toBe(false);
    expect(needsRemarks(null, 50000)).toBe(false);
  });
});

describe('RequisitionsPanel (D26)', () => {
  it("drafts for the Forecast tab's selected window and names it in the notice (Feed Forecast row 8, Step 9)", async () => {
    const to = addDaysIso(todayIso(), 20);
    setForecastWindow({ farmId: 'farm-vil', from: todayIso(), to });
    post.mockImplementation(async () => ({ data: { requisitionId: null, requisition: null } }));
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition/auto-draft', { farmId: 'farm-vil', to }));
    expect(await screen.findByText(`rqNothingToOrder:{"to":"${formatDateShort(to)}"}`)).toBeTruthy();
  });

  it("falls back to the default window when the shared `to` is already past, rather than posting a date the API refuses", async () => {
    setForecastWindow({ farmId: 'farm-vil', from: '2020-01-01', to: '2020-01-07' });
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition/auto-draft', { farmId: 'farm-vil', to: defaultWindowEnd(todayIso()) }));
  });

  it("clamps a forward-dated shared `to` to 45 days ahead, rather than posting a date autoDraft's own bound refuses (M3)", async () => {
    setForecastWindow({ farmId: 'farm-vil', from: todayIso(), to: addDaysIso(todayIso(), 60) });
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition/auto-draft', { farmId: 'farm-vil', to: addDaysIso(todayIso(), 45) }));
  });

  it("ignores another farm's window", async () => {
    setForecastWindow({ farmId: 'farm-other', from: '2099-09-20', to: '2099-10-18' });
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition/auto-draft', { farmId: 'farm-vil', to: defaultWindowEnd(todayIso()) }));
  });

  it("lists the farm's requisitions with labels, not codes, and DD/MM/YY dates (A8, A9)", async () => {
    render(<RequisitionsPanel />);
    const table = await screen.findByRole('table', { name: 'rqListLabel' });
    expect(get).toHaveBeenCalledWith('/feed-requisition?farmId=farm-vil');
    const cells = within(within(table).getAllByRole('row')[1]).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['REQ-VIL100-2026-00004', 'reqTypeForecast', 'reqStatusAutoDraft', 'prioCritical', '23/09/99', '26/09/99', '2', '15,000']);
    expect(screen.queryByText('FEED_FORECAST')).toBeNull();
    expect(screen.getByLabelText('rqType')).toBeTruthy();
  });

  it('filters by status through the API', async () => {
    render(<RequisitionsPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('rqShow'), { target: { value: 'PENDING_APPROVAL' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/feed-requisition?farmId=farm-vil&status=PENDING_APPROVAL'));
  });

  it('drafts from the forecast and opens it with Save and Submit for approval, and no approve or reject (D25)', async () => {
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    expect(post).toHaveBeenCalledWith('/feed-requisition/auto-draft', { farmId: 'farm-vil', to: defaultWindowEnd(todayIso()) });
    expect(screen.getByRole('button', { name: 'rqSubmit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /approve|reject/i })).toBeNull();
    // Task 9: the workbook header form, then the 15-column lines sub-form, with line 20000's batch/house breakdown nested beneath it.
    expect(screen.getByText('rqdHeaderTitle')).toBeTruthy();
    const lines = screen.getByRole('table', { name: 'rqLinesLabel' });
    expect(within(lines).getAllByTestId('rqd-line-no').map((c) => c.textContent)).toEqual(['10000', '20000']);
    expect(within(lines.querySelector('thead') as HTMLElement).getAllByRole('columnheader')).toHaveLength(15);
    expect(within(lines).getAllByText('reqFeedBulk')).toHaveLength(2);
    expect(screen.getByRole('table', { name: 'rqdBreakdownLabel:{"line":20000}' })).toBeTruthy();
  });

  it('asks for remarks when a quantity moves more than 20 %, and submits with them', async () => {
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    fireEvent.change(screen.getByLabelText('rqdRequestedFor:{"line":10000}'), { target: { value: '9000' } });
    // 9d F2: the error names the cause and the line it is on, not a fixed list of two causes.
    expect(screen.getByText(/rqRemarksWhyQuantity/)).toBeTruthy();
    expect(screen.getByText(/10000/, { selector: 'p' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'rqSubmit' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('rqdRemarks'), { target: { value: 'Extra pigs arriving' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqSubmit' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/feed-requisition/req-1/submit', { remarks: 'Extra pigs arriving', lines: [{ line_id: 'L1', quantity_kg: 9000 }] }));
    expect(await screen.findByText('rqSubmitted')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'rqOpenApproval' }).getAttribute('href')).toBe('/approvals/pending?request=ar-1');
    expect(screen.queryByRole('button', { name: 'rqSubmit' })).toBeNull();
  });

  it("asks for remarks when a line's delivery date is moved off the forecast's (Req. row 29), covering the `moved` trigger", async () => {
    const movedView = { ...view, lines: [{ ...view.lines[0], recommended_delivery_date: '2099-09-23' }, view.lines[1]] };
    get.mockImplementation(async (url: string) => (url.startsWith('/feed-requisition/') ? { data: movedView } : { data: [listRow] }));
    post.mockImplementation(async (url: string) =>
      url === '/feed-requisition/auto-draft' ? { data: { requisitionId: 'req-1', requisition: movedView } } : { data: { ...movedView, status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' } });
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    expect(screen.queryByText(/rqRemarksRequired/)).toBeNull();
    fireEvent.change(screen.getByLabelText('rqdDeliveryFor:{"line":10000}'), { target: { value: '2099-09-30' } });
    // 9d F2: the moved date is named — pass 2 found this case told the farm about the 20 % rule instead.
    expect(screen.getByText(/rqRemarksWhyDate/)).toBeTruthy();
    expect(screen.queryByText(/rqRemarksWhyQuantity/)).toBeNull();
    expect((screen.getByRole('button', { name: 'rqSubmit' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('rqdRemarks'), { target: { value: 'Mill asked for a later slot' } });
    expect((screen.getByRole('button', { name: 'rqSubmit' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('asks for remarks when a line carries an item exception, even with no deviation or date change (Requisition row 36)', async () => {
    // M2: the API only ever sets exception_reason when item_id differs from required_item_id
    // (feed-requisition.service.ts ~1105-1119) — item_id must actually differ here too, or this
    // fixture asserts a state the real producer can never emit.
    const exceptionedView = { ...view, lines: [{ ...view.lines[0], item_id: 'r3', item_code: 'FEED-R3', exception_reason: 'Vet instruction' }, view.lines[1]] };
    get.mockImplementation(async (url: string) => (url.startsWith('/feed-requisition/') ? { data: exceptionedView } : { data: [listRow] }));
    post.mockImplementation(async (url: string) =>
      url === '/feed-requisition/auto-draft' ? { data: { requisitionId: 'req-1', requisition: exceptionedView } } : { data: { ...exceptionedView, status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' } });
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    // 9d F2: the item exception is named (Req. row 13).
    expect(screen.getByText(/rqRemarksWhyException/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'rqSubmit' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('rqdRemarks'), { target: { value: 'Vet instruction on record' } });
    expect((screen.getByRole('button', { name: 'rqSubmit' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('saves an edited delivery date', async () => {
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    fireEvent.change(screen.getByLabelText('rqdDeliveryFor:{"line":10000}'), { target: { value: '2099-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqSave' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/feed-requisition/req-1', { remarks: '', lines: [{ line_id: 'L1', proposed_delivery_date: '2099-09-30' }] }));
  });

  it('moves a line to another silo with an excepted feed item and saves both with the reason (Req. rows 13, 43, 45)', async () => {
    const options = {
      destinations: [{ location_id: 'silo-1', location_code: 'VIL100/SILO-001', location_type: 'SILO' }, { location_id: 'silo-3', location_code: 'VIL100/SILO-003', location_type: 'SILO' }],
      items: [{ item_id: 'r1', item_code: 'FEED-R1', item_name: 'Weaner Diet R1' }, { item_id: 'r2', item_code: 'FEED-R2', item_name: 'Weaner Diet R2' }],
    };
    get.mockImplementation(async (url: string) =>
      url.startsWith('/feed-requisition/options') ? { data: options } : url.startsWith('/feed-requisition/') ? { data: view } : { data: [listRow] });
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    expect(get).toHaveBeenCalledWith('/feed-requisition/options?farmId=farm-vil');
    fireEvent.change(await screen.findByLabelText('rqdSiloFor:{"line":10000}'), { target: { value: 'silo-3' } });
    fireEvent.change(screen.getByLabelText('rqdItemFor:{"line":10000}'), { target: { value: 'r2' } });
    fireEvent.change(screen.getByLabelText('rqdExceptionFor:{"line":10000}'), { target: { value: 'Vet instruction' } });
    fireEvent.click(screen.getByRole('button', { name: 'rqSave' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/feed-requisition/req-1', {
      remarks: '', lines: [{ line_id: 'L1', destination_location_id: 'silo-3', item_id: 'r2', exception_reason: 'Vet instruction' }],
    }));
  });

  it('warns before Submit that remarks are needed as soon as an unsaved edit turns a line into an item exception, not only after a prior Save (M2)', async () => {
    const options = {
      destinations: [{ location_id: 'silo-1', location_code: 'VIL100/SILO-001', location_type: 'SILO' }],
      items: [{ item_id: 'r1', item_code: 'FEED-R1', item_name: 'Weaner Diet R1' }, { item_id: 'r3', item_code: 'FEED-R3', item_name: 'Weaner Diet R3' }],
    };
    get.mockImplementation(async (url: string) =>
      url.startsWith('/feed-requisition/options') ? { data: options } : url.startsWith('/feed-requisition/') ? { data: view } : { data: [listRow] });
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    // Before the edit: line 10000's item_id ('r1') matches its required_item_id, no exception.
    expect((screen.getByRole('button', { name: 'rqSubmit' }) as HTMLButtonElement).disabled).toBe(false);
    // The API decides itemException AFTER applying edits (feed-requisition.service.ts ~1105-1119),
    // so the pre-click warning must react to this unsaved edit, not wait for a Save round-trip.
    fireEvent.change(await screen.findByLabelText('rqdItemFor:{"line":10000}'), { target: { value: 'r3' } });
    expect(screen.getByText(/rqRemarksWhyException/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'rqSubmit' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('rqdRemarks'), { target: { value: 'Vet instruction on record' } });
    expect((screen.getByRole('button', { name: 'rqSubmit' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows an error with a retry when the farm list could not be read (Plan S follow-up)', async () => {
    const retry = jest.fn();
    mockFarm = { ...mockFarm, farmId: null, farms: [], failed: true, retry };
    render(<RequisitionsPanel />);
    expect(screen.getByText('rqFarmsLoadFailed')).toBeTruthy();
    expect(screen.queryByText('rqNone')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'rqRetry' }));
    expect(retry).toHaveBeenCalled();
  });

  it('opens the requisition named in the address (the Approvals inbox links here)', async () => {
    window.history.replaceState(null, '', '/inventory/requisitions?id=req-1');
    render(<RequisitionsPanel />);
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    expect(get).toHaveBeenCalledWith('/feed-requisition/req-1');
  });

  // Task 18 (decisions 2026-10-04 "a requisition ... is created and edited
  // in a dialog"): opening a requisition — drafted here or loaded by `?id=`
  // — must show it in an actual dialog (role="dialog"), not inline in place
  // of the list; closing it (the dialog's own close control) returns to the
  // list without a page navigation.
  it('opens an existing requisition in a dialog, and closing it returns to the list (Task 18)', async () => {
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'rqDraftFromForecast' }));
    await screen.findByText('REQ-VIL100-2026-00004', { selector: 'h2' });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('REQ-VIL100-2026-00004', { selector: 'h2' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'rqSubmit' })).toBeTruthy();
    // The dialog wrap supplies its own Back/title strip; the detail's own must not double up.
    expect(screen.queryByRole('button', { name: 'rqBack' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByRole('table', { name: 'rqListLabel' })).toBeTruthy();
  });
});


/**
 * WP1g (decisions.md 2026-10-05): feed requisitions are decided on Feed Forecast
 * -> Requisition, not on the Requisition page. The tab reuses the hub's decide
 * component, so Approve / Reject reach the same /approval/:id endpoints.
 */
describe('Feed Forecast → Requisition — Approve / Reject (WP1g)', () => {
  const pendingRow = { ...listRow, status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' };
  const pendingView = { ...view, status: 'PENDING_APPROVAL', approval_request_id: 'ar-1' };
  const openPending = async () => {
    get.mockImplementation(async (url: string) => (url.startsWith('/feed-requisition/') ? { data: pendingView } : { data: [pendingRow] }));
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByText('REQ-VIL100-2026-00004'));
    return screen.findByRole('dialog');
  };

  it('a pending requisition offers Approve, which posts to /approval/:id/approve and closes the dialog', async () => {
    await openPending();
    fireEvent.click(screen.getByRole('button', { name: 'rhApprove' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/approval/ar-1/approve', {}));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('rhApprovedMsg:{"docNo":"REQ-VIL100-2026-00004"}')).toBeTruthy();
  });

  it('carries the approver remarks to the same endpoint', async () => {
    await openPending();
    fireEvent.change(screen.getByLabelText('rhApproverRemarks'), { target: { value: 'Capacity confirmed' } });
    fireEvent.click(screen.getByRole('button', { name: 'rhApprove' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/approval/ar-1/approve', { remarks: 'Capacity confirmed' }));
  });

  it('Reject asks for a reason and posts it to /approval/:id/reject', async () => {
    await openPending();
    fireEvent.click(screen.getByRole('button', { name: 'rhReject' }));
    fireEvent.change(await screen.findByLabelText('rhRejectionReason'), { target: { value: 'Not this cycle' } });
    fireEvent.click(screen.getByRole('button', { name: 'rhRejectConfirm' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/approval/ar-1/reject', { rejection_reason: 'Not this cycle' }));
  });

  it("a refusal from the server is shown and the dialog stays open", async () => {
    await openPending();
    post.mockRejectedValueOnce(new Error('You cannot approve your own requisition.'));
    fireEvent.click(screen.getByRole('button', { name: 'rhApprove' }));
    expect(await screen.findByText('You cannot approve your own requisition.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('a draft requisition has no Approve / Reject', async () => {
    get.mockImplementation(async (url: string) => (url.startsWith('/feed-requisition/') ? { data: view } : { data: [listRow] }));
    render(<RequisitionsPanel />);
    fireEvent.click(await screen.findByText('REQ-VIL100-2026-00004'));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('button', { name: 'rhApprove' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'rhReject' })).toBeNull();
  });
});
